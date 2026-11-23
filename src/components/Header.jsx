import React from 'react';
import { useStore } from '../store.jsx';
import { useBeijingNow } from '../hooks.js';
import { WEEKDAY_LABELS, formatMonthDay, getSemesterInfo } from '../lib/time.js';
import {
  CalendarIcon,
  ClockIcon,
  TasksIcon,
  UploadIcon,
  SettingsIcon,
  MapPinIcon,
} from './Icons.jsx';
import coursePilotIcon from '../assets/coursepilot-icon.svg';

const TABS = [
  { key: 'today', label: '今日', Icon: ClockIcon },
  { key: 'schedule', label: '课表', Icon: CalendarIcon },
  { key: 'assignments', label: '作业', Icon: TasksIcon },
  { key: 'import', label: '导入课表', Icon: UploadIcon },
  { key: 'settings', label: '设置', Icon: SettingsIcon },
];

export default function Header({ activeTab, onTabChange }) {
  const { settings } = useStore();
  const now = useBeijingNow();
  const info = getSemesterInfo(settings.startDate, settings.totalWeeks, now.dateStr);
  const weekText =
    info.status === 'before' ? '未开学' : info.status === 'after' ? '已结课' : `第 ${info.rawWeek} 周`;

  const openPathly = () => {
    const api = window.coursepilotDesktop;
    if (api?.openPathly) {
      api.openPathly();
      return;
    }
    window.open('https://pathly.top', '_blank', 'noopener,noreferrer');
  };

  return (
    <header className="app-header">
      <div className="header-inner">
        <div className="brand">
          <img className="brand-mark" src={coursePilotIcon} alt="" width={40} height={40} />
          <div className="brand-text">
            <strong>CoursePilot</strong>
            <span>课表助手</span>
          </div>
        </div>

        <nav className="main-nav" aria-label="主导航">
          {TABS.map((tab) => {
            const TabIcon = tab.Icon;
            return (
              <button
                key={tab.key}
                type="button"
                className={`nav-item ${activeTab === tab.key ? 'is-active' : ''}`}
                aria-current={activeTab === tab.key ? 'page' : undefined}
                title={tab.label}
                onClick={() => onTabChange(tab.key)}
              >
                <TabIcon size={16} />
                <span>{tab.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            className="nav-item nav-external"
            onClick={openPathly}
            title="打开 pathly.top"
          >
            <MapPinIcon size={16} />
            <span>寻路</span>
          </button>
        </nav>

        <div className="header-clock" title="北京时间（UTC+8），自动与网络时间保持一致">
          <div className="clock-time">
            {now.timeText}
            <span className="clock-zone">BJT</span>
          </div>
          <div className="clock-meta">
            <span>
              {formatMonthDay(now.dateStr)} {WEEKDAY_LABELS[now.weekday]}
            </span>
            <span
              className={`week-pill ${
                info.status === 'before' ? 'is-before' : info.status === 'after' ? 'is-after' : ''
              }`}
            >
              {weekText}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
