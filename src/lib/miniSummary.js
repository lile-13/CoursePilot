import {
  addDays,
  formatMonthDay,
  getBeijingNow,
  getSemesterInfo,
  weekdayLabel,
} from './time.js';
import { formatDuration, getClassesForDate } from './classReminders.js';
import { parseDueAt } from './reminders.js';

export function formatDueShort(dueAt, nowTs, todayStr) {
  const dueTs = parseDueAt(dueAt);
  if (dueTs == null) return '未设置截止';
  const datePart = String(dueAt).slice(0, 10);
  const timePart = String(dueAt).slice(11, 16);
  const prefix = dueTs < nowTs ? '已逾期 · ' : '';
  if (datePart === todayStr) return `${prefix}今天 ${timePart}`;
  if (datePart === addDays(todayStr, 1)) return `${prefix}明天 ${timePart}`;
  return `${prefix}${formatMonthDay(datePart)} ${timePart}`;
}

/**
 * 悬浮窗展示模型：优先当前课，其次下一节课，并附带最近待交作业。
 */
export function getMiniSummary(state, nowTs = Date.now()) {
  const settings = state?.settings;
  if (!settings) return { ready: false };

  const courses = Array.isArray(state.courses) ? state.courses : [];
  const assignments = Array.isArray(state.assignments) ? state.assignments : [];
  const now = getBeijingNow(new Date(nowTs));
  const info = getSemesterInfo(settings.startDate, settings.totalWeeks, now.dateStr);
  const classes = getClassesForDate(courses, settings, now.dateStr);
  const current = classes.find((item) => nowTs >= item.startTs && nowTs < item.endTs) || null;
  const next = classes.find((item) => item.startTs > nowTs) || null;
  const target = current || next;
  const tomorrow = getClassesForDate(courses, settings, addDays(now.dateStr, 1));

  const pending = assignments.filter((assignment) => assignment && assignment.status !== 'done');
  const nearest = pending
    .map((assignment) => ({ assignment, dueTs: parseDueAt(assignment.dueAt) }))
    .filter((item) => item.dueTs != null)
    .sort((a, b) => a.dueTs - b.dueTs)[0];

  let mode = 'none';
  if (current) mode = 'current';
  else if (next) mode = 'next';
  else if (classes.length) mode = 'done';

  let countdownText = '';
  if (current) {
    countdownText = `还有 ${formatDuration(current.endTs - nowTs)}下课`;
  } else if (next) {
    const remaining = next.startTs - nowTs;
    countdownText = remaining < 60000 ? '即将开始' : `还有 ${formatDuration(remaining)}开始`;
  }

  return {
    ready: true,
    dateStr: now.dateStr,
    weekday: weekdayLabel(now.dateStr),
    weekStatus: info.status,
    weekNumber: info.rawWeek,
    mode,
    course: target
      ? {
          name: target.course.name,
          location: target.session.location || '',
          teacher: target.course.teacher || '',
          startTime: target.startTime,
          endTime: target.endTime,
          startPeriod: target.startPeriod,
          endPeriod: target.endPeriod,
          startTs: target.startTs,
        }
      : null,
    countdownText,
    todayClassCount: classes.length,
    tomorrowHint: tomorrow[0]
      ? `明天 ${tomorrow[0].startTime} · ${tomorrow[0].course.name}`
      : '',
    pendingCount: pending.length,
    nearest: nearest
      ? {
          title: nearest.assignment.title,
          courseName: courses.find((course) => course.id === nearest.assignment.courseId)?.name || '未关联课程',
          dueTs: nearest.dueTs,
          dueText: formatDueShort(nearest.assignment.dueAt, nowTs, now.dateStr),
          overdue: nearest.dueTs < nowTs,
        }
      : null,
  };
}
