import React, { useMemo } from 'react';
import { useStore } from '../store.jsx';
import { useBeijingNow } from '../hooks.js';
import {
  addDays,
  formatMonthDay,
  getSemesterInfo,
  weekdayLabel,
} from '../lib/time.js';
import { formatDuration, getClassesForDate } from '../lib/classReminders.js';
import { parseDueAt } from '../lib/reminders.js';
import { courseToneClass } from '../lib/classColors.js';
import {
  ArrowRightIcon,
  ClockIcon,
  MapPinIcon,
  TasksIcon,
} from './Icons.jsx';

function formatDueText(assignment, nowTs, todayStr) {
  if (!assignment.dueAt) return '未设置截止时间';
  const datePart = assignment.dueAt.slice(0, 10);
  const timePart = assignment.dueAt.slice(11, 16);
  const dueTs = parseDueAt(assignment.dueAt);
  if (dueTs != null && dueTs < nowTs) {
    return `已逾期 · ${formatMonthDay(datePart)} ${timePart}`;
  }
  if (datePart === todayStr) return `今天 ${timePart} 截止`;
  return `${formatMonthDay(datePart)} ${timePart} 截止`;
}

function classStatus(occurrence, nowTs) {
  if (nowTs >= occurrence.endTs) return { key: 'done', label: '已结束' };
  if (nowTs >= occurrence.startTs) return { key: 'current', label: '上课中' };
  return { key: 'upcoming', label: '即将开始' };
}

export default function TodayPage({ onGoSchedule, onGoAssignments }) {
  const { settings, courses, assignments } = useStore();
  const now = useBeijingNow();
  const nowTs = Date.now();
  const info = getSemesterInfo(settings.startDate, settings.totalWeeks, now.dateStr);

  const classes = useMemo(
    () => getClassesForDate(courses, settings, now.dateStr),
    [courses, settings, now.dateStr]
  );
  const tomorrowClasses = useMemo(
    () => getClassesForDate(courses, settings, addDays(now.dateStr, 1)),
    [courses, settings, now.dateStr]
  );

  const current = classes.find((item) => nowTs >= item.startTs && nowTs < item.endTs);
  const next = classes.find((item) => item.startTs > nowTs);
  const pendingCount = assignments.filter((assignment) => assignment.status !== 'done').length;

  const upcomingAssignments = useMemo(
    () =>
      assignments
        .filter((assignment) => assignment.status !== 'done')
        .map((assignment) => ({ assignment, dueTs: parseDueAt(assignment.dueAt) }))
        .filter((item) => item.dueTs != null)
        .sort((a, b) => a.dueTs - b.dueTs)
        .slice(0, 6),
    [assignments]
  );

  const weekText =
    info.status === 'before'
      ? '未开学'
      : info.status === 'after'
        ? '已结课'
        : `第 ${info.rawWeek} 周`;

  const renderHero = () => {
    if (current) {
      return (
        <>
          <span className="today-hero-eyebrow">
            <span className="pulse-dot" />
            正在上课
          </span>
          <h2>{current.course.name}</h2>
          <p className="today-hero-meta">
            {current.session.location || '未填写教室'} · {current.startTime}-{current.endTime}
            {current.course.teacher ? ` · ${current.course.teacher}` : ''}
          </p>
          <span className="today-hero-countdown">
            距离下课还有 {formatDuration(current.endTs - nowTs)}
          </span>
        </>
      );
    }

    if (next) {
      return (
        <>
          <span className="today-hero-eyebrow">下一节课</span>
          <h2>{next.course.name}</h2>
          <p className="today-hero-meta">
            {next.session.location || '未填写教室'} · {next.startTime}-{next.endTime}
            {next.course.teacher ? ` · ${next.course.teacher}` : ''}
          </p>
          <span className="today-hero-countdown">
            还有 {formatDuration(next.startTs - nowTs)}开始
          </span>
        </>
      );
    }

    return (
      <>
        <span className="today-hero-eyebrow">今天</span>
        <h2>{classes.length ? '今天的课已结束' : '今天没有课'}</h2>
        <p className="today-hero-meta">
          {tomorrowClasses[0]
            ? `明天 ${tomorrowClasses[0].startTime} · ${tomorrowClasses[0].course.name}`
            : '可以在课表中查看本周安排'}
        </p>
      </>
    );
  };

  return (
    <div className="page today-page">
      <div className="page-head">
        <div>
          <h1>今天</h1>
          <p className="page-sub">
            北京时间 {formatMonthDay(now.dateStr)} {weekdayLabel(now.dateStr)} · {weekText}
            {info.status === 'ongoing' ? ` · ${info.weekNumber % 2 === 1 ? '单周' : '双周'}` : ''}
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-ghost" onClick={onGoSchedule}>
            查看完整课表
          </button>
          <button type="button" className="btn btn-primary" onClick={onGoAssignments}>
            <TasksIcon size={16} />
            管理作业
          </button>
        </div>
      </div>

      {info.status !== 'ongoing' ? (
        <div className="notice-bar">
          <ClockIcon size={16} />
          {info.status === 'before'
            ? `学期尚未开始，第一周从 ${formatMonthDay(settings.startDate)} 起算，可在“设置”中调整。`
            : `学期已超过设定的 ${settings.totalWeeks} 周，可在“设置”中调整总周数。`}
        </div>
      ) : null}

      <section className="today-hero-card">
        <div className="today-hero-main">{renderHero()}</div>
        <div className="today-hero-side">
          <span className="today-hero-side-label">今天</span>
          <strong>{classes.length}</strong>
          <span>节课</span>
          <span className="today-hero-side-divider" />
          <span className="today-hero-side-label">待交</span>
          <strong>{pendingCount}</strong>
          <span>项作业</span>
        </div>
      </section>

      <div className="today-grid">
        <section className="card today-section">
          <div className="today-section-head">
            <div>
              <h2>今日课程</h2>
              <p>{classes.length ? `${classes.length} 节课，按开始时间排列` : '今天没有安排课程'}</p>
            </div>
            <button type="button" className="btn btn-soft btn-sm" onClick={onGoSchedule}>
              完整课表
              <ArrowRightIcon size={14} />
            </button>
          </div>

          {classes.length ? (
            <div className="today-class-list">
              {classes.map((occurrence) => {
                const status = classStatus(occurrence, nowTs);
                return (
                  <button
                    type="button"
                    key={occurrence.key}
                    className={`today-class-row is-${status.key}`}
                    onClick={onGoSchedule}
                  >
                    <span className="today-class-time">
                      <strong>{occurrence.startTime}</strong>
                      <span>{occurrence.endTime}</span>
                    </span>
                    <span
                      className={`today-class-dot ${courseToneClass(occurrence.course.colorIndex)}`}
                    />
                    <span className="today-class-main">
                      <span className="today-class-title">
                        {occurrence.course.name}
                        {occurrence.course.type === 'lab' ? (
                          <span className="today-lab-tag">实验</span>
                        ) : null}
                      </span>
                      <span className="today-class-meta">
                        <span>
                          <MapPinIcon size={12} />
                          {occurrence.session.location || '未填写教室'}
                        </span>
                        <span>第 {occurrence.startPeriod}-{occurrence.endPeriod} 节</span>
                        {occurrence.course.teacher ? (
                          <span>{occurrence.course.teacher}</span>
                        ) : null}
                      </span>
                    </span>
                    <span className={`today-class-status is-${status.key}`}>
                      {status.label}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="today-empty">
              <ClockIcon size={26} />
              <span>今天没有课程，先享受一下空闲时间。</span>
            </div>
          )}
        </section>

        <section className="card today-section">
          <div className="today-section-head">
            <div>
              <h2>待交作业</h2>
              <p>{upcomingAssignments.length ? '最近截止的作业' : '暂无待交作业'}</p>
            </div>
            <button type="button" className="btn btn-soft btn-sm" onClick={onGoAssignments}>
              全部作业
              <ArrowRightIcon size={14} />
            </button>
          </div>

          {upcomingAssignments.length ? (
            <div className="today-assignment-list">
              {upcomingAssignments.map(({ assignment }) => {
                const course = courses.find((item) => item.id === assignment.courseId);
                const overdue =
                  parseDueAt(assignment.dueAt) != null &&
                  parseDueAt(assignment.dueAt) < nowTs;
                return (
                  <button
                    type="button"
                    key={assignment.id}
                    className={`today-assignment-row ${overdue ? 'is-overdue' : ''}`}
                    onClick={onGoAssignments}
                  >
                    <span className="today-assignment-icon">
                      <TasksIcon size={15} />
                    </span>
                    <span className="today-assignment-main">
                      <span className="today-assignment-title">{assignment.title}</span>
                      <span className="today-assignment-meta">
                        <span>{course?.name || '未关联课程'}</span>
                        <span className={overdue ? 'is-overdue-text' : ''}>
                          {formatDueText(assignment, nowTs, now.dateStr)}
                        </span>
                      </span>
                    </span>
                    <ArrowRightIcon size={14} />
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="today-empty">
              <TasksIcon size={26} />
              <span>没有待交作业，可以安心安排今天。</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
