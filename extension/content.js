/* CoursePilot 东北大学课表导入助手
 * 1. 在东北大学教务系统（含 iframe 内的课表页）注入导入按钮；
 * 2. 自动切换到「学期课表」，按坐标读取整学期课程、星期、节次、周次、教师、教室；
 * 3. 把结构化数据回传给打开它的 CoursePilot，失败时回退到剪贴板。
 */
(() => {
  if (window.__coursePilotNeuInjected) return;
  window.__coursePilotNeuInjected = true;

  const MESSAGE_TYPE = 'COURSEPILOT_SCHEDULE';
  const WIDGET_ID = 'cpx-neu-widget';
  const STATUS_ID = 'cpx-neu-status';
  const APP_URL = 'http://127.0.0.1:5173/#import';
  const APP_ORIGIN = 'http://127.0.0.1:5173';
  const DESKTOP_ORIGIN = 'http://127.0.0.1:17890';
  const DESKTOP_IMPORT_URL = `${DESKTOP_ORIGIN}/api/import`;
  const DAY_MAP = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
  const FALLBACK_DAY_ORDER = [7, 1, 2, 3, 4, 5, 6];
  const SECTION_COUNT = 12;

  let syncTimer = null;
  let statusTimer = null;
  let desktopTimer = null;
  let desktopAvailable = false;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function textOf(node) {
    if (!node) return '';
    const value = node.innerText || node.textContent || '';
    return value.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function rawTextOf(node) {
    return (node?.innerText || node?.textContent || '').replace(/\u00a0/g, ' ');
  }

  function infoLineOf(node) {
    return rawTextOf(node).replace(/\r?\n/g, ' ').replace(/\u00a0/g, ' ').trim();
  }

  function isVisible(element) {
    if (!element || !element.getBoundingClientRect) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 1 && rect.height > 1;
  }

  function looksLikeSchedulePage() {
    if (!document.body) return false;

    if (
      document.querySelector(
        '[class*="TimetableCourseRenderCourseItem"], [class*="schoolTable"], [class*="TimetableDayColumn"]'
      )
    ) {
      return true;
    }

    const urlHint = /(\/kbapp\/|\/kbbpapp\/|wdkb|kbcx|timetable)/i.test(location.href);
    if (!urlHint) return false;

    const text = document.body.innerText || '';
    return /课表|课程表/.test(`${document.title} ${text}`);
  }

  /* ---------------- 课表结构定位 ---------------- */

  function findCards() {
    return Array.from(document.querySelectorAll('[class*="TimetableCourseRenderCourseItem"]')).filter(
      (element) =>
        !/Container|Info/.test(String(element.className || '')) && isVisible(element)
    );
  }

  function findDayColumns() {
    const all = Array.from(document.querySelectorAll('[class*="TimetableDayColumn"]')).filter(
      isVisible
    );
    const byLeft = new Map();
    for (const element of all) {
      const rect = element.getBoundingClientRect();
      const key = Math.round(rect.left / 4) * 4;
      const previous = byLeft.get(key);
      if (!previous || rect.width > previous.getBoundingClientRect().width) {
        byLeft.set(key, element);
      }
    }
    return Array.from(byLeft.values()).sort(
      (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left
    );
  }

  /** 从“星期一/周一”等表头文字定位每一天的横向中心 */
  function findDayAnchors() {
    const groups = new Map();
    const nodes = document.querySelectorAll('div,span,th,td,li,a,b,strong');
    for (const element of nodes) {
      const text = textOf(element);
      const match = text.match(/^(?:星期|周)([一二三四五六日天])(?:\s|$)/);
      if (!match || !isVisible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width > 220 || rect.height > 90) continue;
      const day = DAY_MAP[match[1]];
      const yKey = Math.round(rect.top / 12) * 12;
      if (!groups.has(yKey)) groups.set(yKey, []);
      groups.get(yKey).push({ day, x: rect.left + rect.width / 2 });
    }

    let best = [];
    for (const list of groups.values()) {
      const uniqueDays = new Set(list.map((item) => item.day));
      if (uniqueDays.size >= 5 && list.length > best.length) best = list;
    }

    const byDay = new Map();
    for (const item of best.sort((a, b) => a.x - b.x)) {
      if (!byDay.has(item.day)) byDay.set(item.day, item);
    }
    return Array.from(byDay.values()).sort((a, b) => a.x - b.x);
  }

  function buildColumnDayMap(columns, anchors) {
    const map = new Map();
    if (columns.length && anchors.length >= 5) {
      for (const column of columns) {
        const rect = column.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        let best = anchors[0];
        let bestDiff = Math.abs(centerX - best.x);
        for (const anchor of anchors) {
          const diff = Math.abs(centerX - anchor.x);
          if (diff < bestDiff) {
            best = anchor;
            bestDiff = diff;
          }
        }
        map.set(column, best.day);
      }
      return map;
    }

    // 没有“星期一”等表头时，用所有按天列的横向位置分组（学期课表常见）
    const allColumns = Array.from(
      document.querySelectorAll('[class*="TimetableDayColumn"]')
    ).filter(isVisible);
    const groups = [];
    for (const element of allColumns) {
      const rect = element.getBoundingClientRect();
      let group = groups.find((item) => {
        const overlap = Math.min(item.right, rect.right) - Math.max(item.left, rect.left);
        const minWidth = Math.min(item.right - item.left, rect.width);
        return overlap > Math.min(minWidth * 0.5, 40);
      });
      if (!group) {
        group = { left: rect.left, right: rect.right, center: rect.left + rect.width / 2 };
        groups.push(group);
      } else {
        group.left = Math.min(group.left, rect.left);
        group.right = Math.max(group.right, rect.right);
        group.center = (group.left + group.right) / 2;
      }
    }
    groups.sort((a, b) => a.left - b.left);
    groups.forEach((group, index) => {
      group.day = FALLBACK_DAY_ORDER[index] || null;
    });

    for (const column of columns) {
      const rect = column.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      let best = groups[0];
      let bestDiff = Infinity;
      for (const group of groups) {
        const diff = Math.abs(centerX - group.center);
        if (diff < bestDiff) {
          best = group;
          bestDiff = diff;
        }
      }
      map.set(column, best ? best.day : null);
    }
    return map;
  }

  function dayForCard(card, columnDayMap, anchors) {
    const column = card.closest('[class*="TimetableDayColumnRoot"]') || card.closest('[class*="TimetableDayColumn"]');
    if (column && columnDayMap.has(column)) return columnDayMap.get(column);

    if (anchors.length >= 5) {
      const rect = card.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      let best = anchors[0];
      let bestDiff = Math.abs(centerX - best.x);
      for (const anchor of anchors) {
        const diff = Math.abs(centerX - anchor.x);
        if (diff < bestDiff) {
          best = anchor;
          bestDiff = diff;
        }
      }
      return best.day;
    }
    return null;
  }

  /** 从“第一节”等文字获取每一节的纵向范围 */
  function sectionRectsFromLabels() {
    const byTop = new Map();
    for (const element of document.querySelectorAll('div,span,td,li')) {
      const text = textOf(element);
      if (!/^第[一二三四五六七八九十百0-9]+节(?:\s|$)/.test(text)) continue;
      if (!isVisible(element)) continue;
      const own = element.getBoundingClientRect();
      if (own.width > 220 || own.height > 120) continue;

      const parent = element.parentElement?.getBoundingClientRect();
      let rect = own;
      if (parent && parent.height >= 30 && parent.height <= 160 && parent.height > own.height) {
        rect = parent;
      }
      const key = Math.round(rect.top);
      if (!byTop.has(key)) {
        byTop.set(key, { top: rect.top, height: rect.height, bottom: rect.bottom });
      }
    }
    return Array.from(byTop.values()).sort((a, b) => a.top - b.top);
  }

  function fallbackSectionRects() {
    const columns = findDayColumns();
    const column = columns[1] || columns[0];
    if (!column) return [];
    const rect = column.getBoundingClientRect();
    if (rect.height < 120) return [];
    return Array.from({ length: SECTION_COUNT }, (_, index) => ({
      top: rect.top + (rect.height / SECTION_COUNT) * index,
      height: rect.height / SECTION_COUNT,
      bottom: rect.top + (rect.height / SECTION_COUNT) * (index + 1),
    }));
  }

  function getSectionRects() {
    const labeled = sectionRectsFromLabels();
    if (labeled.length >= 6) return labeled;
    return fallbackSectionRects();
  }

  function timingFromStructure(card) {
    const root = card.closest('[class*="TimetableDayColumnRoot"]');
    const group = card.closest('[class*="TimetableDayColumnConflictContainer"]');
    const column = card.closest('[class*="TimetableCourseRenderColumn"]');
    if (!root || !group || !column || group.parentElement !== root || !group.contains(column)) return null;
    let slot = card;
    while (slot.parentElement && slot.parentElement !== column) slot = slot.parentElement;
    if (slot.parentElement !== column) return null;
    const spanOf = (element) => {
      const span = Number(element.style.flexGrow || getComputedStyle(element).flexGrow);
      return Number.isInteger(span) && span > 0 ? span : null;
    };
    const precedingSpan = (element) => {
      let total = 0;
      for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        const span = spanOf(sibling);
        if (span === null) return null;
        total += span;
      }
      return total;
    };
    const groupOffset = precedingSpan(group);
    const slotOffset = precedingSpan(slot);
    const span = Number(card.dataset.scalesSpan) || spanOf(slot);
    const groupSpan = spanOf(group);
    if (groupOffset === null || slotOffset === null || !Number.isInteger(span) || span < 1 ||
        groupSpan === null || slotOffset + span > groupSpan) return null;
    const start = groupOffset + slotOffset + 1;
    const end = start + span - 1;
    return end <= SECTION_COUNT ? { start, end } : null;
  }

  function findTiming(card, sectionRects) {
    const structural = timingFromStructure(card);
    if (structural) return structural;
    const cardRect = card.getBoundingClientRect();
    const rects = sectionRects.filter((rect) => rect.height > 1);
    if (!rects.length) return null;

    let startIndex = -1;
    for (let index = 0; index < rects.length; index += 1) {
      const rect = rects[index];
      if (cardRect.top >= rect.top - 8 && cardRect.top < rect.bottom - 4) {
        startIndex = index;
        break;
      }
    }
    if (startIndex < 0) {
      let best = -1;
      let bestDiff = Infinity;
      rects.forEach((rect, index) => {
        const diff = Math.abs(cardRect.top - rect.top);
        if (diff < bestDiff) {
          best = index;
          bestDiff = diff;
        }
      });
      if (best >= 0 && bestDiff < (rects[0].height || 60) * 0.9) startIndex = best;
    }
    if (startIndex < 0) return null;

    const spanFromAttr = Number(card.dataset.scalesSpan);
    const spanFromHeight = Math.max(
      1,
      Math.round(cardRect.height / (rects[startIndex].height || cardRect.height))
    );
    const span =
      Number.isFinite(spanFromAttr) && spanFromAttr > 0 ? spanFromAttr : spanFromHeight;
    return {
      start: startIndex + 1,
      end: Math.min(startIndex + span, 16),
    };
  }

  /* ---------------- 课程卡片文本解析 ---------------- */

  function parseDetailLine(line) {
    const weekMatch = line.match(
      /^((?:第?\s*\d+(?:\s*-\s*\d+)?\s*周?\s*(?:[（(][单双]周?[）)])?\s*[,，、]\s*)*第?\s*\d+(?:\s*-\s*\d+)?\s*周(?:[（(][单双]周?[）)])?)/
    );
    if (!weekMatch) return null;

    const weeksText = weekMatch[1]
      .replace(/[（(]/g, '(')
      .replace(/[）)]/g, ')')
      .replace(/[,，、]/g, ',')
      .replace(/\s+/g, '');
    const rest = line.slice(weekMatch[0].length).trim();
    if (!rest) return { weeksText, teacher: '', location: '' };

    let teacher = '';
    let location = '';
    const parts = rest.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      teacher = parts[0];
      location = parts.slice(1).join(' ');
    } else {
      const campusMatch = rest.match(/([\u4e00-\u9fa5]{2,6}校区)/);
      if (campusMatch && campusMatch.index > 0) {
        teacher = rest.slice(0, campusMatch.index).trim();
        location = rest.slice(campusMatch.index).trim();
      } else if (/楼|室|号|馆|场|中心|校区/.test(rest)) {
        location = rest;
      } else {
        teacher = rest;
      }
    }
    return { weeksText, teacher, location };
  }

  function isAssessmentLine(line) {
    return /考试|考查|百分制|五级制|合格制/.test(line) && !/\d+\s*周/.test(line);
  }

  function isDetailLine(line) {
    return Boolean(parseDetailLine(line));
  }

  function isClassName(line) {
    return /^[\u4e00-\u9fa5A-Za-z]{2,12}\d{2,4}[-–]\d{1,3}$/.test(line.trim());
  }

  function stripCourseCode(line) {
    return line
      .replace(/\s+[A-Z][A-Z0-9]{4,}(?:-\S+)?$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  function codeFromNameLine(line) {
    const match = line.match(/([A-Z][A-Z0-9]{4,})(?:-\S+)?$/);
    return match ? match[1] : '';
  }

  function normalizeCourseName(name) {
    return String(name || '')
      .replace(/^[\[【]\s*实\s*[\]】]\s*/, '')
      .replace(/[-—].*$/, '')
      .replace(/\s+/g, '')
      .trim();
  }

  function parseCard(card) {
    const title = textOf(card.querySelector('[class*="title___"]'));
    const code = textOf(card.querySelector('[class*="courseCode"]'));
    const infoLines = Array.from(card.querySelectorAll('[class*="CourseItemInfoText"]'))
      .map(infoLineOf)
      .filter(Boolean);
    // 实验卡片正文常只有名称；读取该卡片自己关联的详情，不借用理论课安排。
    const detailIds = new Set();
    for (const node of [card, card.parentElement, ...card.querySelectorAll('[aria-describedby]')]) {
      for (const id of (node?.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)) {
        detailIds.add(id);
      }
    }
    for (const id of detailIds) {
      const tooltip = document.getElementById(id);
      if (!tooltip) continue;
      const lines = tooltip.querySelectorAll('[class*="CourseItemInfoPopperInfo"], [class*="CourseItemInfoText"]');
      infoLines.push(...(lines.length ? Array.from(lines).map(infoLineOf) : rawTextOf(tooltip).split(/\r?\n/)));
    }

    const nameLine = infoLines.find(
      (line) =>
        !isAssessmentLine(line) && !isDetailLine(line) && !isClassName(line)
    );
    const detailLines = [...new Set(infoLines.filter(isDetailLine))].map(parseDetailLine).filter(Boolean);

    let name = nameLine ? stripCourseCode(nameLine) : title;
    const labFlag = /^[\[【]\s*实\s*[\]】]|实验|上机|实训/.test(`${title} ${name}`);
    name = name.replace(/^[\[【]\s*实\s*[\]】]\s*/, '').trim();
    if (!name) name = title || '未命名课程';

    return {
      name,
      code,
      nameCode: nameLine ? codeFromNameLine(nameLine) : '',
      type: labFlag ? 'lab' : 'theory',
      details: detailLines,
    };
  }

  function baseCode(value) {
    if (!value) return '';
    return value.split('-')[0].trim();
  }

  function extractNeuSchedule() {
    const cards = findCards();
    if (!cards.length) {
      return {
        sessions: [],
        warnings: [
          '未找到课表卡片。请先进入「我的 → 我的课表」，等待课表加载完成后再点击导入。',
        ],
      };
    }

    const anchors = findDayAnchors();
    const cardColumns = [];
    for (const card of cards) {
      const column = card.closest('[class*="TimetableDayColumnRoot"]') || card.closest('[class*="TimetableDayColumn"]');
      if (column && !cardColumns.includes(column)) cardColumns.push(column);
    }
    cardColumns.sort(
      (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left
    );

    if (!cardColumns.length && anchors.length < 5) {
      return {
        sessions: [],
        warnings: ['未找到星期列，请确认课表已显示星期和节次后再试。'],
      };
    }

    const sectionRects = getSectionRects();
    if (sectionRects.length < 6) {
      return {
        sessions: [],
        warnings: ['未找到节次行，请等待课表加载完成后再试。'],
      };
    }

    const columnDayMap = buildColumnDayMap(cardColumns, anchors);
    const parsed = cards.map((card) => ({ card, ...parseCard(card) }));

    const sessions = [];
    const warnings = new Set();
    let missingDetail = false;
    let missingTiming = 0;

    for (const item of parsed) {
      const day = dayForCard(item.card, columnDayMap, anchors);
      if (!day) {
        warnings.add('有课程无法确定星期，已跳过，请在预览中手动补充。');
        continue;
      }

      const timing = findTiming(item.card, sectionRects);
      if (!timing) {
        missingTiming += 1;
        continue;
      }

      let details = item.details;
      if (!details.length) {
        details = [{ weeksText: '', teacher: '', location: '' }];
        missingDetail = true;
        warnings.add(`“${item.name}”未读取到自身的周次、教师或地点，请补充核对后再保存。`);
      }

      for (const detail of details) {
        sessions.push({
          name: item.name,
          teacher: detail.teacher || '',
          type: item.type,
          day,
          start: timing.start,
          end: timing.end,
          location: detail.location || '',
          weeksText: detail.weeksText || '',
        });
      }
    }

    if (missingDetail) {
      warnings.add('部分课程未显示周次或教室，缺失内容已留空，未借用其他课程的信息或默认周次。');
    }
    if (missingTiming > 0) {
      warnings.add(`有 ${missingTiming} 个课程卡片无法确定节次，已跳过，请手动补充。`);
    }

    return { sessions, warnings: Array.from(warnings) };
  }

  /** 自动切到学期课表，确保导入整个学期 */
  async function ensureSemesterView() {
    const candidates = Array.from(document.querySelectorAll('div,button,span,a,li')).filter(
      (element) => textOf(element) === '学期课表' && isVisible(element)
    );
    if (!candidates.length) return false;

    candidates.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
    const target = candidates[0];
    const active =
      /btnActive|is-active/i.test(String(target.className || '')) ||
      target.getAttribute('aria-selected') === 'true';
    if (active) return true;

    target.click();
    await sleep(1200);
    return true;
  }

  /** 读取页面显示的当前教学周，用于校准学期第一周 */
  function detectCurrentWeek() {
    for (const element of document.querySelectorAll('div,span')) {
      if (!isVisible(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.width > 180 || rect.height > 60) continue;
      const match = textOf(element).match(/第\s*(\d{1,2})\s*周/);
      if (!match) continue;
      const value = Number(match[1]);
      if (value >= 1 && value <= 30) return value;
    }
    const match = (document.body.innerText || '').match(/第\s*(\d{1,2})\s*周/);
    return match ? Number(match[1]) : null;
  }

  /** 从页面学期文字识别 termCode，如 2026-2027-1 */
  function detectTermCode() {
    const text = document.body.innerText || '';
    const match = text.match(
      /(20\d{2})\s*[-—–~至]\s*(20\d{2})\s*学年\s*(秋季|春季|夏季|第?[一二三12])\s*学期/
    );
    if (match) {
      const season = match[3];
      const term = /春/.test(season)
        ? '2'
        : /夏/.test(season)
          ? '3'
          : /[二2]/.test(season)
            ? '2'
            : /[三3]/.test(season)
              ? '3'
              : '1';
      return `${match[1]}-${match[2]}-${term}`;
    }
    for (const element of document.querySelectorAll('input,select,option')) {
      const value = element.value || element.getAttribute('value') || '';
      const valueMatch = String(value).match(/(20\d{2}-20\d{2}-[123])/);
      if (valueMatch) return valueMatch[1];
    }
    const codeMatch = text.match(/(20\d{2}-20\d{2}-[123])/);
    return codeMatch ? codeMatch[1] : null;
  }

  function parseWeeksAndTeachers(value, titleDetail) {
    let weeksText = '';
    let teacher = '';
    const raw = String(value || '').trim();
    if (raw) {
      const parts = raw.split('/');
      weeksText = parts[0].replace(/\[[^\]]*\]/g, '').trim();
      const teachers = parts
        .slice(1)
        .map((part) => part.replace(/\[[^\]]*\]/g, '').trim())
        .filter(Boolean);
      teacher = teachers.join('、');
    }
    if (!weeksText && Array.isArray(titleDetail)) {
      const detail = titleDetail.find((line) => /\d+\s*周/.test(line)) || '';
      const detailMatch = detail.match(/^([\d,，、\-\s]+周(?:[（(][单双][）)])?)/);
      if (detailMatch) weeksText = detailMatch[1].replace(/[,，、]/g, ',');
    }
    return { weeksText, teacher };
  }

  /** 优先走教务系统自己的课表接口，拿到整学期结构化数据 */
  async function fetchApiSessions() {
    const termCode = detectTermCode();
    if (!termCode) throw new Error('未识别到当前学期编码');

    const url = `${location.origin}/jwapp/sys/homeapp/api/home/student/getMyScheduleDetail.do`;
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ termCode }).toString(),
    });
    if (!response.ok) throw new Error(`接口返回 HTTP ${response.status}`);

    const json = await response.json();
    if (!json || String(json.code) !== '0' || !json.datas) {
      throw new Error((json && json.msg) || '接口返回数据异常');
    }

    const list = Array.isArray(json.datas.arrangedList) ? json.datas.arrangedList : [];
    const sessions = [];
    const warnings = new Set();
    const seen = new Set();

    for (const record of list) {
      const name = String(record.courseName || '').trim();
      let day = Number(record.dayOfWeek);
      if (day === 0) day = 7;
      const start = Number(record.beginSection);
      const end = Number(record.endSection);
      if (!name || !(day >= 1 && day <= 7) || !(start >= 1) || !(end >= start)) {
        warnings.add('接口中有课程缺少课程名、星期或节次，已跳过。');
        continue;
      }

      const { weeksText, teacher } = parseWeeksAndTeachers(
        record.weeksAndTeachers,
        record.titleDetail
      );
      if (!weeksText) warnings.add(`“${name}”接口未提供周次，请在预览中补充后保存。`);
      let location = String(record.placeName || '').trim();
      const campus = String(record.campusName || '').trim();
      if (campus && !location.startsWith(campus)) location = `${campus} ${location}`.trim();

      // summary字段可能只包含第一组安排；titleDetail才有换教室的全部周次。
      const detailLines = Array.isArray(record.titleDetail) ? record.titleDetail : [];
      const details = [...new Set(detailLines.filter((line) => typeof line === 'string'))]
        .map(parseDetailLine).filter(Boolean);
      const arrangements = details.length ? details : [{ weeksText, teacher, location }];

      const type = /[\[【]实[\]】]|实验|上机|实训/.test(
        `${name} ${record.weeksAndTeachers || ''} ${(record.titleDetail || []).join(' ')}`
      )
        ? 'lab'
        : 'theory';

      for (const detail of arrangements) {
        const key = [name, detail.teacher, type, day, start, end, detail.location, detail.weeksText].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        sessions.push({ name, teacher: detail.teacher || '', type, day, start, end,
          location: detail.location || '', weeksText: detail.weeksText || '' });
      }
    }

    return {
      sessions,
      warnings: Array.from(warnings),
      parserName: '东北大学教务接口',
      termCode,
      sectionTimes: await fetchSectionTimes(list),
    };
  }

  /** 从学校作息时间接口读取当前校区的节次起止时间 */
  async function fetchSectionTimes(scheduleRecords) {
    try {
      const response = await fetch(
        `${location.origin}/jwapp/sys/homeapp/api/dzhome/querySectionInfo.do`,
        { credentials: 'include' }
      );
      if (!response.ok) return null;
      const json = await response.json();
      if (!json || String(json.code) !== '0' || !Array.isArray(json.datas)) return null;

      const campuses = Array.from(
        new Set(json.datas.map((item) => item.campusName).filter(Boolean))
      );
      const counts = new Map();
      for (const record of scheduleRecords || []) {
        const campus = String(record.campusName || '').trim();
        if (campus) counts.set(campus, (counts.get(campus) || 0) + 1);
      }
      const preferred =
        Array.from(counts.entries())
          .sort((a, b) => b[1] - a[1])
          .map(([campus]) => campus)
          .find((campus) => campuses.includes(campus)) || campuses[0];

      const entries = json.datas
        .filter((item) => !preferred || item.campusName === preferred)
        .sort((a, b) => Number(a.id) - Number(b.id));
      const times = entries
        .map((item) => ({ start: item.startTime, end: item.endTime }))
        .filter((item) => item.start && item.end);
      return times.length >= 6 ? times : null;
    } catch (error) {
      console.warn('[CoursePilot] 节次时间接口读取失败', error);
      return null;
    }
  }

  /* ---------------- 页面按钮与回传 ---------------- */

  function buildWidget() {
    const widget = document.createElement('div');
    widget.id = WIDGET_ID;
    widget.innerHTML = [
      '<div class="cpx-tip">进入「我的 → 我的课表」后点击；会自动切换到学期课表并读取整学期</div>',
      '<button type="button" class="cpx-btn">',
      '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">',
      '<path d="M12 3v12M7.5 10.5L12 15l4.5-4.5"/><path d="M4 19.5h16"/>',
      '</svg>',
      '<span>导入整学期课表到 CoursePilot</span>',
      '</button>',
    ].join('');
    widget.querySelector('button').addEventListener('click', handleImport);
    document.body.appendChild(widget);
  }

  function ensureWidget() {
    if (document.getElementById(WIDGET_ID)) return;
    buildWidget();
    startDesktopWatch();
  }

  function removeWidget() {
    document.getElementById(WIDGET_ID)?.remove();
  }

  function syncWidget() {
    if (looksLikeSchedulePage()) ensureWidget();
    else removeWidget();
  }

  function showStatus(message, tone = 'success') {
    let status = document.getElementById(STATUS_ID);
    if (!status) {
      status = document.createElement('div');
      status.id = STATUS_ID;
      document.body.appendChild(status);
    }
    status.textContent = message;
    status.className = `cpx-status is-${tone} is-visible`;
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => status.classList.remove('is-visible'), 8000);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      console.warn('[CoursePilot] 剪贴板写入失败，尝试兼容方案', error);
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;left:-9999px;top:0;';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (error) {
      console.warn('[CoursePilot] 复制失败', error);
    }
    textarea.remove();
    return ok;
  }

  function getAppWindow() {
    if (window.opener && !window.opener.closed) return window.opener;
    try {
      const topOpener = window.top && window.top !== window ? window.top.opener : null;
      if (topOpener && !topOpener.closed) return topOpener;
    } catch (error) {
      // 跨域 iframe 下无法访问时忽略
    }
    return null;
  }

  function runtimeMessage(message) {
    return new Promise((resolve, reject) => {
      if (!chrome?.runtime?.sendMessage) {
        reject(new Error('扩展后台不可用'));
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('扩展后台响应超时'));
        }
      }, 2000);
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve(response);
        });
      } catch (error) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      }
    });
  }

  async function checkDesktopApp() {
    try {
      const response = await runtimeMessage({ type: 'CPX_HEALTH' });
      desktopAvailable = Boolean(response && response.ok);
    } catch (error) {
      try {
        const response = await fetch(`${DESKTOP_ORIGIN}/api/health`, { cache: 'no-store' });
        desktopAvailable = response.ok;
      } catch (fetchError) {
        desktopAvailable = false;
      }
    }
    return desktopAvailable;
  }

  function startDesktopWatch() {
    if (desktopTimer) return;
    checkDesktopApp();
    desktopTimer = setInterval(checkDesktopApp, 8000);
  }

  async function sendToDesktopApp(body) {
    try {
      const response = await runtimeMessage({ type: 'CPX_POST_IMPORT', body });
      if (response && response.ok) return true;
    } catch (error) {
      // 后台脚本不可用时回退到页面 fetch
    }

    try {
      const response = await fetch(DESKTOP_IMPORT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!response.ok) return false;
      const data = await response.json().catch(() => null);
      return Boolean(data && data.ok);
    } catch (error) {
      return false;
    }
  }

  async function handleImport(event) {
    const button = event.currentTarget;
    const label = button.querySelector('span');
    const originalLabel = label ? label.textContent : '';
    const existingAppWindow = getAppWindow();
    let autoAppWindow = null;
    if (!existingAppWindow && !desktopAvailable) {
      try {
        // 在用户点击的同步阶段打开，避免弹窗拦截
        autoAppWindow = window.open(APP_URL, 'coursepilot_app');
      } catch (error) {
        autoAppWindow = null;
      }
    }
    button.disabled = true;
    button.classList.add('is-busy');
    try {
      let extraction = null;
      try {
        extraction = await fetchApiSessions();
      } catch (error) {
        console.warn('[CoursePilot] 课表接口读取失败，回退 DOM 提取', error);
        extraction = {
          sessions: [],
          warnings: [`教务接口读取失败：${error.message || error}`],
          parserName: '',
        };
      }

      if (!extraction.sessions.length) {
        await ensureSemesterView();
        let domExtraction = extractNeuSchedule();
        if (!domExtraction.sessions.length) {
          await sleep(800);
          domExtraction = extractNeuSchedule();
        }
        if (domExtraction.sessions.length) {
          extraction = domExtraction;
        } else {
          extraction = {
            sessions: [],
            warnings: [...(extraction.warnings || []), ...(domExtraction.warnings || [])],
            parserName: '',
          };
        }
      }

      const payload = {
        type: MESSAGE_TYPE,
        version: 2,
        source: 'neu',
        parserName: extraction.parserName || '东北大学教务系统解析器',
        sessions: extraction.sessions,
        warnings: extraction.warnings,
        currentWeek: detectCurrentWeek(),
        termCode: extraction.termCode || null,
        sectionTimes: extraction.sectionTimes || null,
        pageUrl: location.href,
        pageTitle: document.title,
        capturedAt: Date.now(),
      };

      const serialized = JSON.stringify(payload);
      if (existingAppWindow) {
        existingAppWindow.postMessage(payload, '*');
        // 同时写入剪贴板，便于应用未收到消息时使用“从剪贴板读取”兜底
        copyText(serialized).catch(() => {});
        showStatus(
          extraction.sessions.length
            ? `已读取 ${extraction.sessions.length} 个时段，请回到 CoursePilot 查看；若未响应，点击“从剪贴板读取”`
            : extraction.warnings[0] || '未读取到课程，请确认课表已加载完成',
          extraction.sessions.length ? 'success' : 'error'
        );
      } else if (await sendToDesktopApp(serialized)) {
        try {
          autoAppWindow?.close();
        } catch (error) {
          // 窗口已关闭时忽略
        }
        copyText(serialized).catch(() => {});
        showStatus(
          extraction.sessions.length
            ? `已发送 ${extraction.sessions.length} 个时段到 CoursePilot 桌面端`
            : extraction.warnings[0] || '未读取到课程，请确认课表已加载完成',
          extraction.sessions.length ? 'success' : 'error'
        );
      } else if (autoAppWindow) {
        const send = () => {
          try {
            autoAppWindow.postMessage(payload, APP_ORIGIN);
          } catch (error) {
            // 窗口已关闭或跨域，忽略
          }
        };
        setTimeout(send, 600);
        setTimeout(send, 1500);
        setTimeout(send, 3000);
        copyText(serialized).catch(() => {});
        showStatus(
          extraction.sessions.length
            ? `已读取 ${extraction.sessions.length} 个时段，正在打开并发送到 CoursePilot；若未收到，请用“从剪贴板读取”`
            : extraction.warnings[0] || '未读取到课程，请确认课表已加载完成',
          extraction.sessions.length ? 'success' : 'error'
        );
      } else {
        const copied = await copyText(serialized);
        showStatus(
          copied
            ? '已复制课表数据，请回到 CoursePilot 点击“从剪贴板读取”'
            : '无法自动回传，请回到 CoursePilot 使用“粘贴页面源码”',
          copied ? 'success' : 'error'
        );
      }

      if (label) {
        label.textContent = extraction.sessions.length
          ? `已读取 ${extraction.sessions.length} 个时段`
          : '读取失败，请查看页面提示';
        setTimeout(() => {
          label.textContent = originalLabel;
        }, 5000);
      }
    } catch (error) {
      showStatus(`读取课表失败：${error.message || error}`, 'error');
      if (label) {
        label.textContent = '读取失败，请查看页面提示';
        setTimeout(() => {
          label.textContent = originalLabel;
        }, 5000);
      }
    } finally {
      setTimeout(() => {
        button.disabled = false;
        button.classList.remove('is-busy');
      }, 800);
    }
  }

  const observer = new MutationObserver(() => {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncWidget, 500);
  });

  function start() {
    syncWidget();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('popstate', () => setTimeout(syncWidget, 300));
    window.addEventListener('hashchange', () => setTimeout(syncWidget, 300));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
