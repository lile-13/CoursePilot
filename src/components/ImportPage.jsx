import React, { useCallback, useEffect, useRef, useState } from 'react';
import sampleScheduleHtml from '../samples/sample-schedule.html?raw';
import { useStore } from '../store.jsx';
import { parseScheduleHtml } from '../lib/parser/index.js';
import { parseWeekText, formatWeeks } from '../lib/weeks.js';
import { WEEKDAY_LABELS } from '../lib/time.js';
import { BOOKMARKLET_CODE } from '../lib/bookmarklet.js';
import { copyText } from '../lib/clipboard.js';
import { createId } from '../lib/id.js';
import { NEU_SYSTEM_URL, NEU_IMPORT_MESSAGE, isNeuMessageOrigin } from '../lib/neu.js';
import {
  UploadIcon,
  PlusIcon,
  TrashIcon,
  AlertIcon,
  InfoIcon,
  ArrowRightIcon,
  ExternalLinkIcon,
  ClipboardIcon,
  CheckIcon,
} from './Icons.jsx';

const SOURCES = [
  { key: 'file', label: '上传 HTML 文件' },
  { key: 'paste', label: '粘贴页面源码' },
  { key: 'bookmark', label: '书签采集' },
];

const STEPS = ['登录教务系统', '获取课表页源码', '解析并预览', '确认保存'];

function createEmptyDraftSession() {
  return {
    id: createId('draft'),
    name: '',
    teacher: '',
    type: 'theory',
    day: 1,
    start: 1,
    end: 2,
    location: '',
    weeksText: '1-16周',
  };
}

export default function ImportPage({ onDone, desktopImport }) {
  const { settings, actions, notify } = useStore();
  const [source, setSource] = useState('file');
  const [rawText, setRawText] = useState('');
  const [fileName, setFileName] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [draft, setDraft] = useState(null);
  const [importMode, setImportMode] = useState('merge');
  const [error, setError] = useState('');
  const [neuWaiting, setNeuWaiting] = useState(false);
  const neuPopupRef = useRef(null);
  const previewRef = useRef(null);
  const lastImportStampRef = useRef(0);

  const previewPeriodCount = draft?.settingsPatch?.periodsPerDay || settings.periodsPerDay;
  const periodOptions = Array.from({ length: previewPeriodCount }, (_, index) => index + 1);

  const scrollToPreview = () => {
    window.setTimeout(() => {
      previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  };

  const parse = useCallback(
    (text) => {
      const result = parseScheduleHtml(text);
      setDraft(result);
      if (result.sessions.length > 0) {
        setError('');
        notify(`识别到 ${result.sessions.length} 个上课时段，请预览确认`);
      } else {
        setError(result.warnings[0] || '未能识别课表，请确认页面来源。');
      }
      return result;
    },
    [notify]
  );

  const applyStructuredImport = useCallback(
    (data) => {
      const stamp = Number(data.capturedAt) || 0;
      if (stamp && lastImportStampRef.current === stamp) return;
      if (stamp) lastImportStampRef.current = stamp;

      const warnings = Array.isArray(data.warnings) ? data.warnings.filter(Boolean) : [];
      const sessions = (Array.isArray(data.sessions) ? data.sessions : [])
        .map((session) => {
          const start = Math.min(Math.max(Number(session.start) || 1, 1), 16);
          const end = Math.min(Math.max(Number(session.end) || start, start), 16);
          return {
            id: createId('draft'),
            name: String(session.name || '').trim(),
            teacher: String(session.teacher || '').trim(),
            type: session.type === 'lab' ? 'lab' : 'theory',
            day: Math.min(Math.max(Number(session.day) || 1, 1), 7),
            start,
            end,
            location: String(session.location || '').trim(),
            weeksText: String(session.weeksText ?? '').trim(),
          };
        })
        .filter((session) => session.name);

      const sectionTimes = (Array.isArray(data.sectionTimes) ? data.sectionTimes : [])
        .slice(0, 16)
        .map((item) => ({ start: String(item.start || '').trim(), end: String(item.end || '').trim() }));
      const validTime = (time) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
      const hasTimes = sectionTimes.length >= 6 && sectionTimes.every(
        (item) => validTime(item.start) && validTime(item.end) && item.end > item.start
      );
      const settingsPatch = hasTimes
        ? { periodsPerDay: sectionTimes.length, periodTimes: sectionTimes }
        : {};
      if (!hasTimes && data.parserName === '东北大学教务接口') {
        warnings.push('未获取到有效的学校节次时间，请在“设置”中手动核对。');
      }
      setDraft({
        parserName: data.parserName || '东北大学教务系统解析器', sessions, warnings, settingsPatch,
      });
      setSource('neu');
      setNeuWaiting(false);

      if (sessions.length > 0) {
        setError('');
        setFileName(
          data.pageTitle ? `东北大学教务系统 · ${data.pageTitle}` : '东北大学教务系统'
        );

        const currentWeek = Number(data.currentWeek);
        const weekHint =
          Number.isInteger(currentWeek) && currentWeek >= 1 && currentWeek <= 30
            ? `，教务系统当前第 ${currentWeek} 周`
            : '';

        notify(
          `已读取 ${sessions.length} 个上课时段${weekHint}${
            hasTimes ? '，确认保存时将同步学校节次时间' : ''
          }；请到“设置”确认第一周起始日`
        );
        scrollToPreview();
      } else {
        setError(warnings[0] || '未读取到课程，请确认课表已加载完成。');
      }
    },
    [notify]
  );

  // 桌面端：主进程收到扩展回传后，通过 IPC 转发到这里
  useEffect(() => {
    if (!desktopImport?.payload) return;
    applyStructuredImport(desktopImport.payload);
  }, [desktopImport, applyStructuredImport]);

  // 接收东北大学导入助手回传的数据
  useEffect(() => {
    const handleMessage = (event) => {
      if (!isNeuMessageOrigin(event.origin)) return;
      const data = event.data;
      if (!data || data.type !== NEU_IMPORT_MESSAGE) return;

      if (Array.isArray(data.sessions)) {
        applyStructuredImport(data);
        return;
      }

      if (typeof data.html !== 'string') return;
      setNeuWaiting(false);
      setSource('neu');
      setFileName(data.pageTitle ? `东北大学教务系统 · ${data.pageTitle}` : '东北大学教务系统');
      const result = parse(data.html);
      if (result.sessions.length > 0) {
        scrollToPreview();
      } else {
        setError(
          '已收到东北大学课表页面，但通用解析器没有识别出表格课表。请把该页面的 HTML 文件反馈给开发者补充东北大学专属解析规则。'
        );
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [applyStructuredImport, parse]);

  // 教务系统窗口被关闭后结束等待状态；桌面端没有 popup 引用，用超时兜底
  useEffect(() => {
    if (!neuWaiting) return undefined;
    const timer = window.setInterval(() => {
      if (neuPopupRef.current && neuPopupRef.current.closed) setNeuWaiting(false);
    }, 1500);
    const timeout = window.setTimeout(() => setNeuWaiting(false), 10 * 60 * 1000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(timeout);
    };
  }, [neuWaiting]);

  const handleOpenNeu = async () => {
    const desktop = window.coursepilotDesktop;
    if (desktop?.openSchool) {
      setNeuWaiting(true);
      try {
        const result = await desktop.openSchool();
        if (!result?.ok) {
          setNeuWaiting(false);
          notify('打开浏览器失败，请手动访问东北大学教务系统', 'error');
          return;
        }
        notify(
          result.browser === 'edge'
            ? '已打开 Edge，请登录后进入“我的 → 我的课表”'
            : '已用默认浏览器打开，请确认导入助手已安装在该浏览器',
          'info'
        );
      } catch (openError) {
        setNeuWaiting(false);
        notify(`打开浏览器失败：${openError.message || openError}`, 'error');
      }
      return;
    }

    const popup = window.open(NEU_SYSTEM_URL, '_blank');
    if (!popup) {
      notify('浏览器拦截了新窗口，请允许弹窗后重试', 'error');
      return;
    }
    neuPopupRef.current = popup;
    setNeuWaiting(true);
    notify('已打开东北大学教务系统，请登录后进入“我的 → 我的课表”', 'info');
  };

  const handleReadClipboard = async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) {
        throw new Error('当前浏览器不支持读取剪贴板');
      }
      const text = await navigator.clipboard.readText();
      if (!text) throw new Error('剪贴板为空');

      const trimmed = text.trim();
      if (trimmed.startsWith('{')) {
        try {
          const data = JSON.parse(trimmed);
          if (data && Array.isArray(data.sessions)) {
            applyStructuredImport(data);
            return;
          }
        } catch (jsonError) {
          console.warn('剪贴板 JSON 解析失败，按 HTML 处理', jsonError);
        }
      }

      if (!/<table|<html|<div/i.test(text)) {
        throw new Error('剪贴板中既没有课表数据，也没有课表页面源码');
      }
      setSource('paste');
      setRawText(text);
      parse(text);
      setNeuWaiting(false);
      scrollToPreview();
    } catch (readError) {
      notify(`读取剪贴板失败：${readError.message || readError}`, 'error');
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    if (!/\.(html?|htm|txt)$/i.test(file.name)) {
      notify('请选择 .html 或 .htm 文件', 'error');
      return;
    }
    try {
      const text = await file.text();
      setFileName(file.name);
      setRawText(text);
      parse(text);
    } catch (readError) {
      notify(`文件读取失败：${readError.message || readError}`, 'error');
    }
  };

  const fillSample = () => {
    setSource('paste');
    setFileName('示例课表页面.html');
    setRawText(sampleScheduleHtml);
    parse(sampleScheduleHtml);
  };

  const handleCopyBookmarklet = async () => {
    const ok = await copyText(BOOKMARKLET_CODE);
    notify(ok ? '书签代码已复制，可新建书签并粘贴到网址栏' : '复制失败，请手动选择代码复制', ok ? 'success' : 'error');
  };

  const updateDraftSession = (id, patch) => {
    setDraft((current) => ({
      ...current,
      sessions: current.sessions.map((session) =>
        session.id === id ? { ...session, ...patch } : session
      ),
    }));
  };

  const removeDraftSession = (id) => {
    setDraft((current) => ({
      ...current,
      sessions: current.sessions.filter((session) => session.id !== id),
    }));
  };

  const addDraftSession = () => {
    setDraft((current) => ({
      ...current,
      sessions: [...(current?.sessions || []), createEmptyDraftSession()],
    }));
  };

  const confirmImport = () => {
    if (!draft || draft.sessions.length === 0) return;
    const grouped = new Map();
    const seen = new Set();

    for (let index = 0; index < draft.sessions.length; index += 1) {
      const session = draft.sessions[index];
      const rowLabel = `第 ${index + 1} 行`;
      const name = session.name.trim();
      if (!name) {
        setError(`${rowLabel}：课程名称不能为空。`);
        return;
      }
      const start = Number(session.start);
      const end = Number(session.end);
      if (start < 1 || end < start) {
        setError(`${rowLabel}：节次范围不正确。`);
        return;
      }
      if (end > previewPeriodCount) {
        setError(
          `${rowLabel}：节次 ${start}-${end} 超过当前设置的 ${previewPeriodCount} 节，请到“设置”调整节次数或修改此行的节次。`
        );
        return;
      }
      const weeks = parseWeekText(session.weeksText);
      if (!weeks) {
        setError(`${rowLabel}：周次“${session.weeksText}”无法识别，示例：1-16周、2-16周(双)。`);
        return;
      }

      const teacher = session.teacher.trim();
      const courseKey = `${name}||${teacher}||${session.type}`;
      const sessionKey = `${session.day}-${start}-${end}-${session.location.trim()}-${formatWeeks(weeks)}`;
      if (seen.has(`${courseKey}#${sessionKey}`)) continue;
      seen.add(`${courseKey}#${sessionKey}`);

      if (!grouped.has(courseKey)) {
        grouped.set(courseKey, {
          name,
          teacher,
          type: session.type === 'lab' ? 'lab' : 'theory',
          note: '',
          sessions: [],
        });
      }
      grouped.get(courseKey).sessions.push({
        day: Number(session.day),
        start,
        end,
        location: session.location.trim(),
        weeks,
      });
    }

    const courses = [...grouped.values()];
    if (!courses.length) {
      setError('没有可导入的课程。');
      return;
    }

    actions.saveImportedCourses(courses, importMode, draft.settingsPatch || {});
    const sessionCount = courses.reduce((total, course) => total + course.sessions.length, 0);
    notify(
      importMode === 'replace'
        ? `已用 ${courses.length} 门课程替换课表`
        : `已导入 ${courses.length} 门课程 / ${sessionCount} 个时段`
    );
    onDone();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>导入课表</h1>
          <p className="page-sub">从学校教务系统的课表页读取课程信息，预览确认后再保存到本机</p>
        </div>
      </div>

      <div className="neu-card">
        <div className="neu-card-main">
          <span className="neu-tag">东北大学 · 专属导入</span>
          <h2>一键导入我的课表</h2>
          <p className="neu-desc">
            点击下方按钮打开东北大学教务系统，完成统一身份认证后进入「我的 → 我的课表」，
            再点击页面右下角的“导入整学期课表到 CoursePilot”。扩展会自动切换到「学期课表」，
            读取整学期课程并回传预览。
          </p>
          <div className="neu-actions">
            <button type="button" className="btn neu-primary" onClick={handleOpenNeu}>
              <ExternalLinkIcon size={16} />
              打开教务系统并导入
            </button>
            <button type="button" className="btn neu-ghost" onClick={handleReadClipboard}>
              <ClipboardIcon size={16} />
              从剪贴板读取
            </button>
          </div>
          {neuWaiting ? (
            <>
              <div className="neu-waiting">
                <span className="pulse-dot" />
                正在等待课表数据，请在新窗口登录并点击页面右下角的导入按钮…
              </div>
              <p className="neu-note">
                看不到导入按钮？请确认扩展已加载并刷新课表页；按钮会出现在课表区域右下角。
              </p>
            </>
          ) : null}
          <p className="neu-note">
            教务系统需在校园网或学校 WebVPN 环境下访问；课表页面只在本机解析。
          </p>
        </div>
        <ol className="neu-flow">
          <li>
            <span>1</span>打开教务系统
          </li>
          <li>
            <span>2</span>统一身份认证登录
          </li>
          <li>
            <span>3</span>进入我的课表
          </li>
          <li>
            <span>4</span>点击导入，自动切学期课表
          </li>
        </ol>
      </div>

      <details className="neu-setup">
        <summary>首次使用：安装东北大学导入助手（每台电脑一次）</summary>
        <ol>
          <li>
            在 Chrome 或 Edge 打开扩展管理页：<code>chrome://extensions</code>（Edge 为{' '}
            <code>edge://extensions</code>），开启“开发者模式”。
          </li>
          <li>
            点击“加载已解压的扩展程序”，选择本项目中的 <code>extension</code> 文件夹。
          </li>
          <li>回到本页刷新，再点击“打开教务系统并导入”。</li>
        </ol>
        <p>助手只在东北大学教务系统页面注入导入按钮并回传课表页面，不会获取你的账号密码。</p>
      </details>

      <div className="section-divider">
        <span>或使用其他方式导入</span>
      </div>

      <div className="steps">
        {STEPS.map((label, index) => (
          <div className="step" key={label}>
            <span className="step-number">{index + 1}</span>
            <span className="step-label">{label}</span>
            {index < STEPS.length - 1 ? <span className="step-line" /> : null}
          </div>
        ))}
      </div>

      <div className="card import-card">
        {source === 'neu' ? (
          <div className="neu-received">
            <CheckIcon size={15} />
            已通过东北大学导入助手读取课表，请在下方预览中确认；保存前可在“设置”里手动选择第一周起始日。
          </div>
        ) : null}
        <div className="import-tabs">
          {SOURCES.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`import-tab ${source === item.key ? 'is-active' : ''}`}
              onClick={() => setSource(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {source === 'file' ? (
          <div>
            <label
              className={`dropzone ${dragActive ? 'is-drag' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                handleFile(event.dataTransfer.files?.[0]);
              }}
            >
              <input
                type="file"
                accept=".html,.htm,text/html"
                onChange={(event) => handleFile(event.target.files?.[0])}
              />
              <span className="dropzone-icon">
                <UploadIcon size={26} />
              </span>
              <strong>拖拽 HTML 文件到这里，或点击选择文件</strong>
              <span>在课表页按 Ctrl+S（Mac 为 ⌘+S），保存类型选“网页，仅 HTML”，然后上传该文件</span>
              {fileName ? <span className="file-chip">{fileName}</span> : null}
            </label>
            <p className="field-hint">
              文件只在本机浏览器中解析，不会上传到任何服务器。解析成功后可在下方预览并修改。
            </p>
          </div>
        ) : null}

        {source === 'paste' ? (
          <div>
            <textarea
              className="paste-area"
              rows={9}
              value={rawText}
              onChange={(event) => setRawText(event.target.value)}
              placeholder="在此粘贴课表页面的 HTML 源码，通常以 <html> 或 <table> 开头。可在课表页右键选择“查看网页源代码”后复制，或使用“书签采集”。"
            />
            <div className="paste-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={fillSample}>
                填入内置示例源码
              </button>
              <div className="paste-actions-right">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setRawText('');
                    setDraft(null);
                    setError('');
                  }}
                >
                  清空
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => parse(rawText)}
                  disabled={!rawText.trim()}
                >
                  解析课表
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {source === 'bookmark' ? (
          <div className="bookmark-layout">
            <div className="bookmark-instructions">
              <ol>
                <li>登录学校教务系统，进入“课表查询 / 我的课表”页面，等待课程内容加载完成。</li>
                <li>把右侧“采集课表”按钮拖到浏览器书签栏；也可以复制下方代码，新建书签后粘贴到网址栏。</li>
                <li>停留在课表页面，点击该书签，页面源码会自动复制到剪贴板。</li>
                <li>回到本页面，在“粘贴页面源码”标签中粘贴并解析。</li>
              </ol>
              <div className="bookmarklet-row">
                <a
                  className="bookmarklet-link"
                  href={BOOKMARKLET_CODE}
                  draggable
                  onClick={(event) => {
                    event.preventDefault();
                    handleCopyBookmarklet();
                  }}
                >
                  采集课表
                </a>
                <span className="field-hint">点击复制书签代码，或直接拖到书签栏</span>
              </div>
              <p className="field-hint">
                源码只在本机解析，不会上传；请勿在截图或分享时暴露账号信息。
              </p>
            </div>
            <div className="bookmark-code">
              <div className="bookmark-code-head">
                <span>书签代码</span>
                <button type="button" className="btn btn-soft btn-sm" onClick={handleCopyBookmarklet}>
                  复制代码
                </button>
              </div>
              <code>{BOOKMARKLET_CODE}</code>
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="form-error">
          <AlertIcon size={16} />
          {error}
        </div>
      ) : null}

      {draft && draft.warnings.length > 0 ? (
        <div className="warning-list">
          <div className="warning-title">
            <AlertIcon size={16} />
            解析提示
          </div>
          <ul>
            {draft.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {draft && draft.sessions.length > 0 ? (
        <div className="card preview-card" ref={previewRef}>
          <div className="preview-head">
            <div>
              <h2>预览识别结果</h2>
              <p>
                {draft.parserName} 识别到 {draft.sessions.length} 个上课时段。可直接修改下方内容，确认无误后保存。
              </p>
            </div>
            <div className="preview-actions-top">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                setDraft(null);
                setError('');
                lastImportStampRef.current = 0;
              }}>
                取消导入
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={addDraftSession}>
                <PlusIcon size={14} />
                添加一行
              </button>
            </div>
          </div>

          {draft.settingsPatch?.periodTimes ? (
            <p className="field-hint">已读取学校节次时间，将在确认保存时与课表一起同步；取消不会修改原设置。</p>
          ) : null}

          <div className="preview-table-scroll">
            <div className="preview-table">
              <div className="preview-head-row">
                <span>课程名称</span>
                <span>教师</span>
                <span>类型</span>
                <span>星期</span>
                <span>节次</span>
                <span>周次</span>
                <span>教室</span>
                <span />
              </div>
              {draft.sessions.map((session) => (
                <div className="preview-row" key={session.id}>
                  <input
                    type="text"
                    value={session.name}
                    onChange={(event) => updateDraftSession(session.id, { name: event.target.value })}
                    placeholder="课程名称"
                    aria-label="课程名称"
                  />
                  <input
                    type="text"
                    value={session.teacher}
                    onChange={(event) => updateDraftSession(session.id, { teacher: event.target.value })}
                    placeholder="教师"
                    aria-label="教师"
                  />
                  <select
                    value={session.type}
                    onChange={(event) => updateDraftSession(session.id, { type: event.target.value })}
                    aria-label="课程类型"
                  >
                    <option value="theory">理论</option>
                    <option value="lab">实验</option>
                  </select>
                  <select
                    value={session.day}
                    onChange={(event) => updateDraftSession(session.id, { day: Number(event.target.value) })}
                    aria-label="星期"
                  >
                    {WEEKDAY_LABELS.map((label, index) => (
                      <option key={label} value={index + 1}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <div className="preview-period">
                    <select
                      value={session.start}
                      onChange={(event) =>
                        updateDraftSession(session.id, { start: Number(event.target.value) })
                      }
                      aria-label="开始节次"
                    >
                      {periodOptions.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                    <span>-</span>
                    <select
                      value={session.end}
                      onChange={(event) =>
                        updateDraftSession(session.id, { end: Number(event.target.value) })
                      }
                      aria-label="结束节次"
                    >
                      {periodOptions.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    type="text"
                    value={session.weeksText}
                    onChange={(event) => updateDraftSession(session.id, { weeksText: event.target.value })}
                    placeholder="1-16周"
                    aria-label="周次"
                  />
                  <input
                    type="text"
                    value={session.location}
                    onChange={(event) => updateDraftSession(session.id, { location: event.target.value })}
                    placeholder="教室"
                    aria-label="教室"
                  />
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    onClick={() => removeDraftSession(session.id)}
                    aria-label="删除这一行"
                  >
                    <TrashIcon size={15} />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="preview-summary">
            <div className="import-mode">
              <span className="field-label">导入方式</span>
              <label className={`mode-option ${importMode === 'merge' ? 'is-selected' : ''}`}>
                <input
                  type="radio"
                  name="import-mode"
                  value="merge"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                />
                <span>
                  合并导入
                  <small>保留现有课表，同名课程合并，重复时段自动跳过</small>
                </span>
              </label>
              <label className={`mode-option ${importMode === 'replace' ? 'is-selected' : ''}`}>
                <input
                  type="radio"
                  name="import-mode"
                  value="replace"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                />
                <span>
                  覆盖课表
                  <small>替换上课安排，作业关联保留；未导入的旧课程仅保留作业信息</small>
                </span>
              </label>
            </div>
            <button type="button" className="btn btn-primary btn-lg" onClick={confirmImport}>
              确认并保存
              <ArrowRightIcon size={16} />
            </button>
          </div>
        </div>
      ) : null}

      <div className="import-tip">
        <InfoIcon size={16} />
        <span>
          解析失败怎么办？请确认复制的是课表查询页面且课程已加载；也可以把该页面的 HTML
          发给开发者补充专属解析规则。当前内置的是通用表格解析器，适用于大多数表格形式课表。
        </span>
      </div>
    </div>
  );
}
