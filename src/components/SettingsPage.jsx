import React, { useEffect, useState } from 'react';
import { useStore } from '../store.jsx';
import { useBeijingNow } from '../hooks.js';
import {
  WEEKDAY_LABELS,
  formatFullDate,
  formatMonthDay,
  getSemesterInfo,
  getWeekRange,
  weekdayIndex,
} from '../lib/time.js';
import { DEFAULT_PERIOD_TIMES, STORAGE_KEY } from '../lib/storage.js';
import { CLASS_REMINDER_OPTIONS, normalizeClassReminderMinutes } from '../lib/classReminders.js';
import {
  DownloadIcon,
  UploadIcon,
  RefreshIcon,
  TrashIcon,
  InfoIcon,
  LogoutIcon,
} from './Icons.jsx';

export default function SettingsPage({ currentUser = null, onLogout = null }) {
  const { state, settings, courses, assignments, actions, notify, storageKind, databasePath } = useStore();
  const now = useBeijingNow();
  const desktopApi = typeof window !== 'undefined' ? window.coursepilotDesktop : null;
  const [desktopPrefs, setDesktopPrefs] = useState(null);
  const [desktopBusy, setDesktopBusy] = useState(false);
  const info = getSemesterInfo(settings.startDate, settings.totalWeeks, now.dateStr);

  useEffect(() => {
    if (!desktopApi?.getPreferences) return undefined;
    let alive = true;
    desktopApi
      .getPreferences()
      .then((result) => {
        if (alive && result?.ok) setDesktopPrefs(result);
      })
      .catch(() => {});
    const off = desktopApi.onPreferencesChanged?.((patch) => {
      if (alive) setDesktopPrefs((current) => ({ ...(current || {}), ...patch }));
    });
    return () => {
      alive = false;
      off?.();
    };
  }, [desktopApi]);

  const handleAutoLaunch = async (enabled) => {
    if (!desktopApi?.setAutoLaunch || desktopBusy) return;
    setDesktopBusy(true);
    try {
      const result = await desktopApi.setAutoLaunch(enabled);
      if (!result?.ok) {
        notify(result?.error || '开机自启动设置失败', 'error');
        return;
      }
      setDesktopPrefs((current) => ({
        ...(current || {}),
        autoLaunch: { ...(current?.autoLaunch || {}), enabled: result.enabled },
      }));
      notify(enabled ? '已开启开机自启动' : '已关闭开机自启动');
    } finally {
      setDesktopBusy(false);
    }
  };

  const handleMiniVisible = async (visible) => {
    if (!desktopApi || desktopBusy) return;
    setDesktopBusy(true);
    try {
      const result = visible
        ? await desktopApi.showMiniWindow()
        : await desktopApi.hideMiniWindow();
      if (!result?.ok) {
        notify(result?.error || '悬浮窗操作失败', 'error');
        return;
      }
      setDesktopPrefs((current) => ({ ...(current || {}), miniVisible: result.visible }));
    } finally {
      setDesktopBusy(false);
    }
  };
  const statusText =
    info.status === 'before' ? '学期未开始' : info.status === 'after' ? '学期已结束' : `第 ${info.rawWeek} 周`;

  const handleStartDateChange = (value) => {
    if (!value) return;
    actions.updateSettings({ startDate: value });
  };

  const handlePeriodsChange = (value) => {
    const count = Number(value);
    const overflow = courses.some((course) =>
      course.sessions.some((session) => Number(session.end) > count)
    );
    if (overflow && !window.confirm(`有课程节次超过 ${count} 节，超出部分将不会显示。确定修改吗？`)) {
      return;
    }
    const periodTimes = Array.from({ length: count }, (_, index) => ({
      start: settings.periodTimes[index]?.start || DEFAULT_PERIOD_TIMES[index]?.start || '08:00',
      end: settings.periodTimes[index]?.end || DEFAULT_PERIOD_TIMES[index]?.end || '08:45',
    }));
    actions.updateSettings({ periodsPerDay: count, periodTimes });
  };

  const updatePeriodTime = (index, field, value) => {
    const periodTimes = settings.periodTimes.map((item, itemIndex) =>
      itemIndex === index ? { ...item, [field]: value } : item
    );
    actions.updateSettings({ periodTimes });
  };

  const handleExport = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `coursepilot-backup-${now.dateStr}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('备份文件已导出');
  };

  const handleBackupFile = async (file) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !data.settings || !Array.isArray(data.courses) || !Array.isArray(data.assignments)) {
        throw new Error('文件结构不正确');
      }
      if (!window.confirm('导入备份会覆盖当前全部数据，确定继续吗？')) return;
      if (!await actions.replaceState(data)) return;
      notify('备份已导入，课表与作业已恢复');
    } catch (error) {
      notify(`备份文件无法导入：${error.message || error}`, 'error');
    }
  };

  const handleLoadDemo = async () => {
    if (
      (courses.length > 0 || assignments.length > 0) &&
      !window.confirm('载入示例数据会覆盖当前课表与作业，确定继续吗？')
    ) {
      return;
    }
    if (!await actions.loadDemo()) return;
    notify('已载入示例课表与作业数据');
  };

  const handleReset = async () => {
    if (!window.confirm('确定清空所有课表和作业数据吗？此操作不可撤销，建议先导出备份。')) return;
    if (!await actions.resetAll()) return;
    notify('所有数据已清空');
  };

  const handleLogout = async () => {
    if (!onLogout) return;
    if (!window.confirm('退出后将回到登录页，确定退出当前账号吗？')) return;
    setDesktopBusy(true);
    try {
      await onLogout();
    } catch (error) {
      notify(error.message || '退出登录失败', 'error');
    } finally {
      setDesktopBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>设置</h1>
          <p className="page-sub">账号、学期时间、节次时间、提醒与本地数据管理</p>
        </div>
      </div>

      <div className="settings-stack">
        {currentUser ? (
          <section className="card settings-card">
            <div className="settings-card-head">
              <h2>账号</h2>
              <span className="settings-status">本地账号</span>
            </div>
            <div className="account-row">
              <span className="account-avatar">
                {(currentUser.username || '?').slice(0, 1).toUpperCase()}
              </span>
              <div className="account-main">
                <strong>{currentUser.username}</strong>
                <span>课表和作业保存在此账号独立的 SQLite 数据库中</span>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={handleLogout}
                disabled={desktopBusy || !onLogout}
              >
                <LogoutIcon size={16} />
                退出登录 / 切换账号
              </button>
            </div>
            <p className="field-hint">
              数据会在每次操作后自动保存；退出登录不会删除数据，重新登录即可恢复。
            </p>
          </section>
        ) : null}

        <div className="settings-columns">
          <div className="settings-column">
        <section className="card settings-card">
          <div className="settings-card-head">
            <h2>学期与周次</h2>
            <span className="settings-status">{statusText}</span>
          </div>
          <label className="field">
            <span className="field-label">学期名称</span>
            <input
              type="text"
              value={settings.semesterName}
              onChange={(event) => actions.updateSettings({ semesterName: event.target.value })}
              placeholder="例如：2026-2027 学年第一学期"
            />
          </label>
          <div className="form-grid">
            <label className="field">
              <span className="field-label">第一周起始日</span>
              <input
                type="date"
                value={settings.startDate}
                onChange={(event) => handleStartDateChange(event.target.value)}
              />
              <span className="field-hint">
                选择第一周的第一天，周几都可以；课表从这一天开始排列 7 天。东北大学通常选第一周的周日。
              </span>
            </label>
            <label className="field">
              <span className="field-label">学期总周数</span>
              <input
                type="number"
                min="1"
                max="30"
                value={settings.totalWeeks}
                onChange={(event) => {
                  const value = Math.min(Math.max(Number(event.target.value) || 1, 1), 30);
                  actions.updateSettings({ totalWeeks: value });
                }}
              />
              <span className="field-hint">用于周次切换和单双周判断</span>
            </label>
          </div>
          <div className="semester-preview">
            <span>
              第一周起始日：{formatFullDate(settings.startDate)}（
              {WEEKDAY_LABELS[weekdayIndex(settings.startDate)]}）
            </span>
            <span>
              当前显示：{statusText}
              {info.status === 'ongoing'
                ? ` · ${formatMonthDay(getWeekRange(settings.startDate, info.weekNumber).start)} - ${formatMonthDay(
                    getWeekRange(settings.startDate, info.weekNumber).end
                  )}`
                : ''}
            </span>
          </div>
        </section>

        <section className="card settings-card">
          <div className="settings-card-head">
            <h2>提醒</h2>
            <span className="settings-status">
              {storageKind === 'sqlite' ? '桌面版 · 托盘运行' : '桌面版可用'}
            </span>
          </div>
          <label className="field">
            <span className="field-label">上课前提醒</span>
            <select
              value={normalizeClassReminderMinutes(settings.classReminderMinutes)}
              onChange={(event) =>
                actions.updateSettings({ classReminderMinutes: Number(event.target.value) })
              }
            >
              {CLASS_REMINDER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="field-hint">
              到时间会弹出 Windows 通知，显示课程、教室和节次；最小化到托盘也会提醒，点击通知打开今日视图。同一节课只提醒一次。
            </span>
          </label>
        </section>

        {storageKind === 'sqlite' ? (
          <section className="card settings-card">
            <div className="settings-card-head">
              <h2>桌面与启动</h2>
              <span className="settings-status">仅桌面版</span>
            </div>
            <label className="toggle-row">
              <span>
                <strong>开机自启动</strong>
                <small>
                  登录 Windows 后静默进入托盘，不弹出主窗口；关闭窗口后上课与作业提醒继续运行。
                </small>
              </span>
              <input
                type="checkbox"
                checked={Boolean(desktopPrefs?.autoLaunch?.enabled)}
                disabled={desktopBusy || !desktopPrefs?.isPackaged}
                onChange={(event) => handleAutoLaunch(event.target.checked)}
              />
            </label>
            <label className="toggle-row">
              <span>
                <strong>迷你悬浮窗</strong>
                <small>
                  在桌面右下角显示当前课、下一节课和最近待交作业，点击悬浮窗打开今日视图。
                </small>
              </span>
              <input
                type="checkbox"
                checked={Boolean(desktopPrefs?.miniVisible)}
                disabled={desktopBusy || !desktopPrefs}
                onChange={(event) => handleMiniVisible(event.target.checked)}
              />
            </label>
            {desktopPrefs && !desktopPrefs.isPackaged ? (
              <p className="field-hint">开发模式无法注册开机自启动，打包版可用；悬浮窗可直接测试。</p>
            ) : null}
            <p className="field-hint">
              开机自启动指向当前 EXE 路径，移动或重命名 EXE 后请重新开关一次。从托盘“退出 CoursePilot”后提醒会停止。
            </p>
          </section>
        ) : null}
          </div>

          <div className="settings-column">
        <section className="card settings-card">
          <div className="settings-card-head">
            <h2>数据管理</h2>
            <span className="settings-status">
              {courses.length} 门课程 · {assignments.length} 项作业
            </span>
          </div>
          <p className="settings-text">
            {storageKind === 'sqlite' ? '数据保存在本机 SQLite 数据库中，建议定期导出备份。'
              : '数据保存在本机浏览器 localStorage 中，换浏览器或清理缓存前请先导出备份。'}
          </p>
          <div className="settings-actions">
            <button type="button" className="btn btn-ghost" onClick={handleExport}>
              <DownloadIcon size={16} />
              导出备份
            </button>
            <label className="btn btn-ghost file-btn">
              <UploadIcon size={16} />
              导入备份
              <input
                type="file"
                accept="application/json,.json"
                onChange={(event) => handleBackupFile(event.target.files?.[0])}
              />
            </label>
            <button type="button" className="btn btn-ghost" onClick={handleLoadDemo}>
              <RefreshIcon size={16} />
              载入示例数据
            </button>
          </div>
          <div className="settings-danger">
            <div>
              <strong>危险操作</strong>
              <span>清空后无法恢复，建议先导出备份。</span>
            </div>
            <button type="button" className="btn btn-danger-ghost" onClick={handleReset}>
              <TrashIcon size={16} />
              清空所有数据
            </button>
          </div>
        </section>

        <section className="card settings-card">
          <div className="settings-card-head">
            <h2>节次时间</h2>
            <label className="inline-field">
              <span>每天节数</span>
              <select
                value={settings.periodsPerDay}
                onChange={(event) => handlePeriodsChange(event.target.value)}
              >
                {Array.from({ length: 11 }, (_, index) => index + 6).map((value) => (
                  <option key={value} value={value}>
                    {value} 节
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="period-list">
            {settings.periodTimes.map((time, index) => (
              <div className="period-row" key={index}>
                <span className="period-no">第 {index + 1} 节</span>
                <input
                  type="time"
                  value={time.start}
                  onChange={(event) => updatePeriodTime(index, 'start', event.target.value)}
                  aria-label={`第 ${index + 1} 节开始时间`}
                />
                <span className="period-dash">-</span>
                <input
                  type="time"
                  value={time.end}
                  onChange={(event) => updatePeriodTime(index, 'end', event.target.value)}
                  aria-label={`第 ${index + 1} 节结束时间`}
                />
              </div>
            ))}
          </div>
          <p className="field-hint">节次时间会显示在课表左侧，并用于判断“现在正在上”的课程。</p>
        </section>

        <section className="card settings-card">
          <div className="settings-card-head">
            <h2>关于</h2>
            <span className="settings-status">v1.6.2</span>
          </div>
          <div className="about-list">
            <p>
              <InfoIcon size={15} />
              CoursePilot 课表助手：个人课表与课程作业管理系统，支持课表导入、周次切换、单双周、实验课与作业截止提醒。
            </p>
            <p>时间基准：北京时间（UTC+8），不依赖电脑本地时区。</p>
            <p style={{ overflowWrap: 'anywhere' }}>存储位置：{storageKind === 'sqlite'
              ? databasePath : `浏览器 localStorage（键名 ${STORAGE_KEY}）`}。</p>
            <p>解析课表仅在本机进行，网页源码与个人数据不会上传到服务器。</p>
          </div>
        </section>
          </div>
        </div>
      </div>
    </div>
  );
}
