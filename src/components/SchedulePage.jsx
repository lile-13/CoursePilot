import React, { useState } from 'react';
import { useStore } from '../store.jsx';
import { useBeijingNow } from '../hooks.js';
import {
  formatMonthDay,
  formatShortDate,
  getSemesterInfo,
  getWeekRange,
  weekdayLabel,
} from '../lib/time.js';
import { isWeekActive } from '../lib/weeks.js';
import WeekGrid from './WeekGrid.jsx';
import CourseDetail from './CourseDetail.jsx';
import CourseEditor from './CourseEditor.jsx';
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  UploadIcon,
  RefreshIcon,
  InfoIcon,
} from './Icons.jsx';

export default function SchedulePage({ onGoImport }) {
  const { settings, courses: allCourses, actions, notify } = useStore();
  const courses = allCourses.filter((course) => !course.archived);
  const now = useBeijingNow();
  const [week, setWeek] = useState(() => {
    const info = getSemesterInfo(settings.startDate, settings.totalWeeks, now.dateStr);
    return info.weekNumber;
  });
  const [editor, setEditor] = useState(null);
  const [detailCourse, setDetailCourse] = useState(null);

  const info = getSemesterInfo(settings.startDate, settings.totalWeeks, now.dateStr);
  const safeWeek = Math.min(Math.max(week, 1), settings.totalWeeks);
  const range = getWeekRange(settings.startDate, safeWeek);
  const parityLabel = safeWeek % 2 === 1 ? '单周' : '双周';

  let activeSessionCount = 0;
  const activeCourseIds = new Set();
  for (const course of courses) {
    for (const session of course.sessions) {
      if (isWeekActive(session.weeks, safeWeek)) {
        activeSessionCount += 1;
        activeCourseIds.add(course.id);
      }
    }
  }

  const handleDemo = async () => {
    if (!await actions.loadDemo()) return;
    notify('已载入示例课表与作业数据');
    setWeek(info.weekNumber);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{settings.semesterName}</h1>
          <p className="page-sub">
            北京时间 {formatMonthDay(now.dateStr)} {weekdayLabel(now.dateStr)} · 当前第 {info.rawWeek > 0 ? info.rawWeek : 1} 周
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-ghost" onClick={onGoImport}>
            <UploadIcon size={16} />
            导入课表
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setEditor({ mode: 'create' })}>
            <PlusIcon size={16} />
            新增课程
          </button>
        </div>
      </div>

      {info.status !== 'ongoing' ? (
        <div className="notice-bar">
          <InfoIcon size={16} />
          {info.status === 'before'
            ? `学期尚未开始，第 1 周从 ${formatMonthDay(settings.startDate)} 起算，可在“设置”中调整。`
            : `学期已超过设定的 ${settings.totalWeeks} 周，可在“设置”中调整总周数。`}
        </div>
      ) : null}

      <div className="schedule-toolbar">
        <div className="week-switcher">
          <button
            type="button"
            className="icon-btn"
            aria-label="上一周"
            onClick={() => setWeek(Math.max(safeWeek - 1, 1))}
            disabled={safeWeek <= 1}
          >
            <ChevronLeftIcon size={18} />
          </button>
          <select
            className="week-select"
            value={safeWeek}
            onChange={(event) => setWeek(Number(event.target.value))}
            aria-label="选择周次"
          >
            {Array.from({ length: settings.totalWeeks }, (_, index) => {
              const weekNumber = index + 1;
              const weekRange = getWeekRange(settings.startDate, weekNumber);
              return (
                <option key={weekNumber} value={weekNumber}>
                  第 {weekNumber} 周（{formatShortDate(weekRange.start)} - {formatShortDate(weekRange.end)}）
                </option>
              );
            })}
          </select>
          <button
            type="button"
            className="icon-btn"
            aria-label="下一周"
            onClick={() => setWeek(Math.min(safeWeek + 1, settings.totalWeeks))}
            disabled={safeWeek >= settings.totalWeeks}
          >
            <ChevronRightIcon size={18} />
          </button>
          <button type="button" className="btn btn-soft btn-sm" onClick={() => setWeek(info.weekNumber)}>
            回到本周
          </button>
        </div>

        <div className="toolbar-meta">
          <span className={`parity-badge ${safeWeek % 2 === 1 ? 'is-odd' : 'is-even'}`}>{parityLabel}</span>
          <span className="toolbar-range">
            {formatMonthDay(range.start)} - {formatMonthDay(range.end)}
          </span>
          <span className="toolbar-divider" />
          <span>
            {activeCourseIds.size} 门课 · {activeSessionCount} 个时段
          </span>
        </div>
      </div>

      {courses.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <CalendarIcon size={34} />
          </div>
          <h2>还没有课表</h2>
          <p>
            登录学校教务系统并打开课表页，使用“导入课表”读取课程信息，
            预览确认后保存；也可以先载入示例数据体验完整功能。
          </p>
          <div className="empty-actions">
            <button type="button" className="btn btn-primary" onClick={onGoImport}>
              <UploadIcon size={16} />
              导入课表
            </button>
            <button type="button" className="btn btn-ghost" onClick={handleDemo}>
              <RefreshIcon size={16} />
              载入示例数据
            </button>
          </div>
        </div>
      ) : (
        <>
          <WeekGrid
            courses={courses}
            settings={settings}
            week={safeWeek}
            todayDateStr={now.dateStr}
            now={now}
            onOpenCourse={(course) => setDetailCourse(course)}
            onCreateAt={(day, start) => setEditor({ mode: 'create', preset: { day, start } })}
          />
          <p className="grid-hint">提示：点击空白格可快速添加课程，点击课程块可查看详情、课件或编辑课程。</p>
        </>
      )}

      {detailCourse ? (
        <CourseDetail
          course={detailCourse}
          onClose={() => setDetailCourse(null)}
          onEdit={(course) => {
            setDetailCourse(null);
            setEditor({ mode: 'edit', course });
          }}
        />
      ) : null}

      {editor ? (
        <CourseEditor
          course={editor.course}
          preset={editor.preset}
          onClose={() => setEditor(null)}
        />
      ) : null}
    </div>
  );
}
