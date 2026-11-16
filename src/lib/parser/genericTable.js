import { createId } from '../id.js';

const WEEKDAY_MAP = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const BLOCK_TAGS = new Set([
  'div', 'p', 'li', 'ul', 'ol', 'tr', 'td', 'th', 'table', 'tbody', 'thead',
  'section', 'article', 'header', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'span', 'a', 'strong', 'b', 'em', 'label', 'font', 'center',
]);

function textOf(node) {
  return (node?.textContent || '').replace(/\s+/g, ' ').trim();
}

function weekdayFromText(text) {
  const compact = String(text).replace(/\s+/g, '');
  const match = compact.match(/(?:星期|周|礼拜)([一二三四五六日天])/);
  if (match) return WEEKDAY_MAP[match[1]] || 0;
  if (/^[一二三四五六日天]$/.test(compact)) return WEEKDAY_MAP[compact] || 0;
  return 0;
}

function isSeparator(line) {
  return /^[-—_=~]{3,}$/.test(line.trim());
}

function looksLikeWeek(line) {
  if (!/周/.test(line)) return false;
  return /\d/.test(line) || /单|双/.test(line);
}

function looksLikeLocation(line) {
  const text = line.trim();
  if (!text) return false;
  if (/(楼|教室|机房|实验室|实验中心|体育馆|操场|田径场|球场|游泳馆|报告厅|礼堂|校区|中心|号楼|号|室|馆|场)/.test(text)) {
    return true;
  }
  // 兼容“教1-201 / 教3-502 / A101-2”等教室写法
  return /^[A-Za-z\u4e00-\u9fa5]{0,4}\d{1,3}[-－]?\d{1,4}$/.test(text);
}

function looksLikeTeacher(line) {
  const text = line.trim();
  if (!text || text.length > 24) return false;
  if (/老师|教授|讲师|助教/.test(text)) return true;
  if (/^[\u4e00-\u9fa5][\u4e00-\u9fa5·]{1,3}([，,、/]\s*[\u4e00-\u9fa5·]{2,4})*$/.test(text)) return true;
  return /^[A-Za-z][A-Za-z .'-]{1,24}$/.test(text) && text.split(/\s+/).length <= 3;
}

function extractLines(cell) {
  const parts = [];
  const walk = (node) => {
    if (node.nodeType === 3) {
      parts.push(node.nodeValue);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === 'br') {
      parts.push('\n');
      return;
    }
    if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'sup') return;
    const isBlock = BLOCK_TAGS.has(tag);
    if (isBlock) parts.push('\n');
    node.childNodes.forEach(walk);
    if (isBlock) parts.push('\n');
  };
  cell.childNodes.forEach(walk);
  return parts
    .join('')
    .split(/\r?\n/)
    .map((line) => line.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((line) => line && line !== '-' && line !== '--');
}

function buildMatrix(table) {
  const rows = Array.from(table.rows || []);
  const matrix = rows.map(() => []);
  const occupied = rows.map(() => []);
  rows.forEach((row, rowIndex) => {
    let col = 0;
    for (const cell of Array.from(row.cells || [])) {
      while (occupied[rowIndex] && occupied[rowIndex][col]) col += 1;
      const rowSpan = Math.max(1, cell.rowSpan || 1);
      const colSpan = Math.max(1, cell.colSpan || 1);
      for (let i = 0; i < rowSpan; i += 1) {
        for (let j = 0; j < colSpan; j += 1) {
          const r = rowIndex + i;
          const c = col + j;
          if (!matrix[r]) matrix[r] = [];
          if (!occupied[r]) occupied[r] = [];
          occupied[r][c] = true;
          matrix[r][c] = { cell, origin: i === 0 && j === 0 };
        }
      }
      col += colSpan;
    }
  });
  return matrix;
}

function findHeaderRow(matrix) {
  const limit = Math.min(matrix.length, 10);
  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const columns = {};
    let hits = 0;
    (matrix[rowIndex] || []).forEach((entry, col) => {
      if (!entry) return;
      const day = weekdayFromText(textOf(entry.cell));
      if (day) {
        columns[col] = day;
        hits += 1;
      }
    });
    if (hits >= 4) return { rowIndex, columns };
  }
  return null;
}

function detectPeriodRange(labelText) {
  const compact = String(labelText).replace(/\s+/g, '');
  if (!compact) return null;
  let match = compact.match(/第?(\d+)[-—–~至到](\d+)节/);
  if (match) return { start: Number(match[1]), end: Number(match[2]) };
  match = compact.match(/第?(\d+)节/);
  if (match) return { start: Number(match[1]), end: Number(match[1]) };
  match = compact.match(/^(\d+)[-—–~](\d+)$/);
  if (match) return { start: Number(match[1]), end: Number(match[2]) };
  match = compact.match(/^(\d+)$/);
  if (match) return { start: Number(match[1]), end: Number(match[1]) };
  return null;
}

function splitCellBlocks(lines) {
  const segments = [];
  let current = [];
  for (const line of lines) {
    if (isSeparator(line)) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push(line);
    }
  }
  if (current.length) segments.push(current);

  const blocks = [];
  for (const segment of segments) {
    if (segment.filter(looksLikeWeek).length <= 1) {
      blocks.push(segment);
      continue;
    }
    let buffer = [];
    for (const line of segment) {
      buffer.push(line);
      if (looksLikeWeek(line)) {
        blocks.push(buffer);
        buffer = [];
      }
    }
    if (buffer.length) {
      const tail = buffer.every((line) => looksLikeLocation(line) || looksLikeTeacher(line));
      if (tail && blocks.length) {
        blocks[blocks.length - 1].push(...buffer);
      } else {
        blocks.push(buffer);
      }
    }
  }
  return blocks.filter((block) => block.length);
}

function classifyBlock(block) {
  let weekText = '';
  const rest = [];
  for (const line of block) {
    if (!weekText && looksLikeWeek(line)) {
      weekText = line;
    } else {
      rest.push(line);
    }
  }

  let location = '';
  const others = [];
  for (const line of rest) {
    if (!location && looksLikeLocation(line)) location = line;
    else others.push(line);
  }

  let teacher = '';
  if (others.length > 1) {
    for (let i = others.length - 1; i >= 1; i -= 1) {
      if (looksLikeTeacher(others[i])) {
        teacher = others[i];
        others.splice(i, 1);
        break;
      }
    }
  }

  let name = (others[0] || rest[0] || block[0] || '').trim();
  name = name.replace(/^[◇◆●○*★☆■□·\s-]+/, '').trim();
  if (!name || name.length > 60) return null;
  if (isSeparator(name)) return null;

  const type = /实验|实训|上机/.test(name) || /实验|机房|上机/.test(location) ? 'lab' : 'theory';
  return { name, teacher, location, weekText, type };
}

function scoreTable(table) {
  const text = textOf(table);
  let weekdayHits = 0;
  for (const weekday of ['一', '二', '三', '四', '五', '六', '日']) {
    if (new RegExp(`(?:星期|周)\\s*${weekday}`).test(text)) weekdayHits += 1;
  }
  if (weekdayHits < 4) return 0;
  let score = weekdayHits * 3;
  if (/课表|课程表|我的课表/.test(text)) score += 4;
  if (/节次|节/.test(text)) score += 2;
  if (table.querySelectorAll('td,th').length > 20) score += 2;
  return score;
}

function parseTable(table) {
  const matrix = buildMatrix(table);
  if (!matrix.length) return null;
  const header = findHeaderRow(matrix);
  if (!header) return null;

  const sessions = [];
  const warnings = new Set();
  const seenCells = new Set();
  let periodCursor = 1;
  let missingWeekCount = 0;

  for (let rowIndex = header.rowIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] || [];
    const labelParts = [];
    row.forEach((entry, col) => {
      if (entry && !(col in header.columns)) labelParts.push(textOf(entry.cell));
    });
    const detected = detectPeriodRange(labelParts.join(' '));
    const start = detected ? detected.start : periodCursor;
    const end = detected ? detected.end : periodCursor;
    periodCursor = (detected ? detected.end : periodCursor) + 1;
    if (start > 16 || end > 16) continue;

    for (const colKey of Object.keys(header.columns)) {
      const day = header.columns[colKey];
      const entry = row[Number(colKey)];
      if (!entry || !entry.origin || seenCells.has(entry.cell)) continue;
      seenCells.add(entry.cell);
      const lines = extractLines(entry.cell);
      if (!lines.length) continue;

      for (const block of splitCellBlocks(lines)) {
        const parsed = classifyBlock(block);
        if (!parsed) continue;
        if (!parsed.weekText) {
          missingWeekCount += 1;
          warnings.add('有课程未识别到周次，已按“1-16周”处理，请在预览中确认。');
        }
        sessions.push({
          id: createId('draft'),
          name: parsed.name,
          teacher: parsed.teacher,
          type: parsed.type,
          day,
          start,
          end,
          location: parsed.location,
          weeksText: parsed.weekText || '1-16周',
        });
      }
    }
  }

  if (!sessions.length) return null;

  return {
    sessions,
    warnings: [...warnings],
    missingWeekCount,
  };
}

export function parseWithGenericTable(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, noscript').forEach((node) => node.remove());
  const candidates = Array.from(doc.querySelectorAll('table'))
    .map((table) => ({ table, score: scoreTable(table) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  for (const candidate of candidates) {
    try {
      const result = parseTable(candidate.table);
      if (result && result.sessions.length) {
        const sessions = result.sessions.sort((a, b) => a.day - b.day || a.start - b.start || a.name.localeCompare(b.name));
        return {
          parserName: '通用表格解析器',
          sessions,
          warnings: result.warnings,
        };
      }
    } catch (error) {
      console.warn('解析表格失败', error);
    }
  }
  return null;
}
