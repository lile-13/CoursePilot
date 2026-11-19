import React, { useCallback, useEffect, useState } from 'react';
import { getMiniSummary } from '../lib/miniSummary.js';
import { ExternalLinkIcon, XIcon } from './Icons.jsx';

function weekText(summary) {
  if (summary.weekStatus === 'before') return '未开学';
  if (summary.weekStatus === 'after') return '已结课';
  return `第 ${summary.weekNumber} 周`;
}

export default function MiniWindow() {
  const api = typeof window !== 'undefined' ? window.coursepilotDesktop : null;
  const [data, setData] = useState(undefined);
  const [error, setError] = useState('');
  const [nowTs, setNowTs] = useState(() => Date.now());

  const load = useCallback(async () => {
    if (!api?.database?.read) {
      setError('悬浮窗仅桌面版可用');
      return;
    }
    try {
      const result = await api.database.read();
      if (!result?.ok) {
        setError(result?.error || '读取数据失败');
        return;
      }
      setData(result.state || null);
      setError('');
    } catch (loadError) {
      setError(loadError.message || String(loadError));
    }
  }, [api]);

  useEffect(() => {
    document.body.classList.add('mini-mode');
    return () => document.body.classList.remove('mini-mode');
  }, []);

  useEffect(() => {
    load();
    const off = api?.onDatabaseChanged?.(() => load());
    const timer = window.setInterval(load, 10000);
    return () => {
      off?.();
      window.clearInterval(timer);
    };
  }, [api, load]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowTs(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const openMain = () => {
    api?.openMain?.('today');
  };

  const summary = getMiniSummary(data, nowTs);
  const modeLabel =
    summary.mode === 'current'
      ? '正在上课'
      : summary.mode === 'next'
        ? '下一节课'
        : summary.mode === 'done'
          ? '今天的课已结束'
          : '今天没有课';

  return (
    <div className="mini-shell">
      <div className="mini-bar">
        <span className="mini-brand">CoursePilot</span>
        <div className="mini-bar-actions">
          <button type="button" className="mini-icon-btn" onClick={openMain} title="打开主界面">
            <ExternalLinkIcon size={13} />
          </button>
          <button
            type="button"
            className="mini-icon-btn"
            onClick={() => api?.hideMiniWindow?.()}
            title="隐藏悬浮窗"
          >
            <XIcon size={14} />
          </button>
        </div>
      </div>

      {error ? (
        <div className="mini-state">
          <strong>无法读取数据</strong>
          <span>{error}</span>
          <button type="button" className="mini-retry" onClick={load}>
            重新读取
          </button>
        </div>
      ) : summary.ready ? (
        <button type="button" className="mini-content" onClick={openMain} title="打开今日视图">
          <span className="mini-eyebrow">
            {summary.course
              ? `${modeLabel} · ${weekText(summary)} · ${summary.weekday}`
              : `${weekText(summary)} · ${summary.weekday}`}
          </span>
          <strong className="mini-title">
            {summary.course ? summary.course.name : summary.mode === 'done' ? '今天的课已结束' : '今天没有课'}
          </strong>
          <span className="mini-meta">
            {summary.course
              ? `${summary.course.startTime}-${summary.course.endTime} · ${
                  summary.course.location || '未填写教室'
                }`
              : summary.tomorrowHint || '打开主界面查看课表'}
          </span>
          {summary.course ? <span className="mini-countdown">{summary.countdownText}</span> : null}
          <span className="mini-footer">
            <span>待交 {summary.pendingCount} 项</span>
            {summary.nearest ? (
              <span className={summary.nearest.overdue ? 'is-overdue' : ''}>
                {summary.nearest.title} · {summary.nearest.dueText}
              </span>
            ) : (
              <span>暂无待交截止</span>
            )}
          </span>
        </button>
      ) : (
        <div className="mini-state">
          <strong>正在加载</strong>
          <span>正在读取本机课表…</span>
        </div>
      )}
    </div>
  );
}
