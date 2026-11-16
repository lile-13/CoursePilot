import React, { useMemo } from 'react';
import {
  WEEKDAY_LABELS,
  dateForDisplayIndex,
  formatShortDate,
  timeTextToMinutes,
  weekdayIndex,
  weekOrderFromStartDate,
} from '../lib/time.js';
import { isWeekActive } from '../lib/weeks.js';
import { courseToneClass } from '../lib/classColors.js';
import { MapPinIcon } from './Icons.jsx';

function collectItems(courses, week) {
  const items = [];
  for (const course of courses) {
    for (const session of course.sessions) {
      if (!isWeekActive(session.weeks, week)) continue;
      items.push({ key: `${course.id}:${session.id}`, course, session });
    }
  }
  return items;
}

/** 同一时段有多门课程（如理论课与实验课冲突）时并排显示 */
function computeLanes(items) {
  const result = new Map();
  const byDay = new Map();
  for (const item of items) {
    if (!byDay.has(item.session.day)) byDay.set(item.session.day, []);
    byDay.get(item.session.day).push(item);
  }

  for (const dayItems of byDay.values()) {
    const sorted = [...dayItems].sort(
      (a, b) => a.session.start - b.session.start || a.session.end - b.session.end
    );
    let cluster = [];
    let clusterEnd = 0;

    const flush = () => {
      if (!cluster.length) return;
      const laneEnds = [];
      const assigned = [];
      for (const item of cluster) {
        let lane = laneEnds.findIndex((end) => end < item.session.start);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(0);
        }
        laneEnds[lane] = item.session.end;
        assigned.push({ key: item.key, lane });
      }
      for (const entry of assigned) {
        result.set(entry.key, { lane: entry.lane, laneCount: laneEnds.length });
      }
      cluster = [];
      clusterEnd = 0;
    };

    for (const item of sorted) {
      if (cluster.length && item.session.start > clusterEnd) flush();
      cluster.push(item);
      clusterEnd = Math.max(clusterEnd, item.session.end);
    }
    flush();
  }

  return result;
}

export default function WeekGrid({
  courses,
  settings,
  week,
  todayDateStr,
  now,
  onEditCourse,
  onCreateAt,
}) {
  const periods = settings.periodsPerDay;
  const dayOrder = weekOrderFromStartDate(settings.startDate);
  const items = useMemo(
    () => collectItems(courses, week).filter((item) => item.session.start <= periods),
    [courses, week, periods]
  );
  const lanes = useMemo(() => computeLanes(items), [items]);

  return (
    <div className="week-grid-scroll">
      <div
        className="week-grid"
        style={{ gridTemplateRows: `50px repeat(${periods}, 62px)` }}
      >
        <div className="wg-corner" style={{ gridRow: 1, gridColumn: 1 }}>
          <span>节次</span>
          <span className="wg-corner-sub">时间</span>
        </div>

        {dayOrder.map((courseDay, index) => {
          const dateStr = dateForDisplayIndex(settings.startDate, week, index);
          const isToday = dateStr === todayDateStr;
          const label = WEEKDAY_LABELS[courseDay - 1];
          return (
            <div
              key={courseDay}
              className={`wg-day-head ${isToday ? 'is-today' : ''}`}
              style={{ gridRow: 1, gridColumn: index + 2 }}
            >
              <span className="wg-day-name">{label}</span>
              <span className="wg-day-date">{formatShortDate(dateStr)}</span>
              {isToday ? <span className="wg-today-dot">今天</span> : null}
            </div>
          );
        })}

        {Array.from({ length: periods }, (_, index) => {
          const periodNumber = index + 1;
          const time = settings.periodTimes[index] || { start: '', end: '' };
          return (
            <React.Fragment key={periodNumber}>
              <div className="wg-time" style={{ gridRow: periodNumber + 1, gridColumn: 1 }}>
                <span className="wg-period">第{periodNumber}节</span>
                <span className="wg-clock">
                  {time.start}
                  <br />
                  {time.end}
                </span>
              </div>
              {dayOrder.map((courseDay, dayIndex) => {
                const dateStr = dateForDisplayIndex(settings.startDate, week, dayIndex);
                const isToday = dateStr === todayDateStr;
                const isWeekend = weekdayIndex(dateStr) >= 5;
                return (
                  <div
                    key={`${periodNumber}-${courseDay}`}
                    className={`wg-cell ${isToday ? 'is-today' : ''} ${
                      isWeekend ? 'is-weekend' : ''
                    }`}
                    style={{ gridRow: periodNumber + 1, gridColumn: dayIndex + 2 }}
                    onClick={() => onCreateAt(courseDay, periodNumber)}
                  />
                );
              })}
            </React.Fragment>
          );
        })}

        {items.map((item) => {
          const { course, session } = item;
          const displayIndex = dayOrder.indexOf(session.day);
          if (displayIndex < 0) return null;
          const laneInfo = lanes.get(item.key) || { lane: 0, laneCount: 1 };
          const isOverlap = laneInfo.laneCount > 1;
          const startTime = timeTextToMinutes(settings.periodTimes[session.start - 1]?.start);
          const endTime = timeTextToMinutes(settings.periodTimes[session.end - 1]?.end);
          const todayDate = dateForDisplayIndex(settings.startDate, week, displayIndex);
          const isNow =
            todayDate === todayDateStr &&
            now &&
            startTime !== null &&
            endTime !== null &&
            now.minutes >= startTime &&
            now.minutes <= endTime;

          const style = {
            gridRow: `${session.start + 1} / ${Math.min(session.end, periods) + 2}`,
            gridColumn: `${displayIndex + 2} / ${displayIndex + 3}`,
            width: isOverlap ? `calc(${100 / laneInfo.laneCount}% - 6px)` : 'calc(100% - 8px)',
            marginLeft: isOverlap
              ? `calc(${(100 / laneInfo.laneCount) * laneInfo.lane}% + 3px)`
              : '4px',
          };

          return (
            <button
              type="button"
              key={item.key}
              className={`course-block ${courseToneClass(course.colorIndex)} ${
                course.type === 'lab' ? 'is-lab' : ''
              } ${isNow ? 'is-now' : ''}`}
              style={style}
              title={`${course.name}${course.teacher ? ` · ${course.teacher}` : ''}\n第${session.start}-${session.end}节${
                session.location ? ` · ${session.location}` : ''
              }`}
              onClick={() => onEditCourse(course)}
            >
              <span className="cb-top">
                <span className="cb-name">{course.name}</span>
                {course.type === 'lab' ? <span className="cb-badge">实验</span> : null}
              </span>
              {session.location ? (
                <span className="cb-meta">
                  <MapPinIcon size={11} />
                  {session.location}
                </span>
              ) : null}
              <span className="cb-meta cb-meta-soft">
                {session.start === session.end
                  ? `第${session.start}节`
                  : `第${session.start}-${session.end}节`}
                {course.teacher ? ` · ${course.teacher}` : ''}
              </span>
              {isNow ? <span className="cb-now">现在</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
