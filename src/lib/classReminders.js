import { getBeijingNow, getSemesterInfo, weekdayIndex, WEEKDAY_LABELS, formatMonthDay } from './time.js';
import { isWeekActive } from './weeks.js';

export const DEFAULT_CLASS_REMINDER_MINUTES = 10;

export const CLASS_REMINDER_OPTIONS = [
  { value: 0, label: '关闭上课提醒' },
  { value: 5, label: '提前 5 分钟' },
  { value: 10, label: '提前 10 分钟' },
  { value: 15, label: '提前 15 分钟' },
];

export function normalizeClassReminderMinutes(value) {
  const minutes = Number(value);
  return [0, 5, 10, 15].includes(minutes) ? minutes : DEFAULT_CLASS_REMINDER_MINUTES;
}

/** 北京时间日期 + HH:mm 转成真实时间戳 */
export function beijingDateTimeToTs(dateStr, timeText) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(String(timeText || ''));
  if (!dateMatch || !timeMatch) return null;
  const [, year, month, day] = dateMatch;
  const [, hour, minute] = timeMatch;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - 8,
    Number(minute)
  );
}

/**
 * 返回某一天实际发生的课程（已应用周次、单双周和节次时间）。
 */
export function getClassesForDate(courses, settings, dateStr) {
  if (!settings || !dateStr) return [];
  const info = getSemesterInfo(settings.startDate, settings.totalWeeks, dateStr);
  if (info.status !== 'ongoing') return [];

  const periods = Math.min(Math.max(Number(settings.periodsPerDay) || 12, 1), 16);
  const periodTimes = Array.isArray(settings.periodTimes) ? settings.periodTimes : [];
  const todayDay = weekdayIndex(dateStr) + 1;
  const occurrences = [];

  for (const course of courses || []) {
    if (!course || course.archived) continue;
    for (const session of course.sessions || []) {
      if (Number(session.day) !== todayDay) continue;
      if (!isWeekActive(session.weeks, info.weekNumber)) continue;

      const startPeriod = Number(session.start);
      const endPeriod = Number(session.end);
      if (!Number.isInteger(startPeriod) || startPeriod < 1 || startPeriod > periods) continue;

      const startTime = periodTimes[startPeriod - 1]?.start;
      const endTime =
        periodTimes[Math.min(endPeriod, periods) - 1]?.end ||
        periodTimes[startPeriod - 1]?.end;
      if (!startTime) continue;

      const startTs = beijingDateTimeToTs(dateStr, startTime);
      const endTs = endTime
        ? beijingDateTimeToTs(dateStr, endTime)
        : startTs + 45 * 60 * 1000;
      if (startTs == null) continue;

      occurrences.push({
        key: `${course.id}:${session.id}:${dateStr}:${startTime}`,
        course,
        session,
        dateStr,
        startTime,
        endTime: endTime || '',
        startPeriod,
        endPeriod: Math.min(endPeriod, periods),
        startTs,
        endTs,
        weekNumber: info.weekNumber,
      });
    }
  }

  return occurrences.sort(
    (a, b) => a.startTs - b.startTs || a.course.name.localeCompare(b.course.name, 'zh-CN')
  );
}

/**
 * 当前应该提醒的上课记录：未提醒过、在提前量窗口内、还没开始上课。
 */
export function getDueClassReminders(courses, settings, nowTs = Date.now()) {
  if (!settings) return [];
  const leadMinutes = normalizeClassReminderMinutes(settings.classReminderMinutes);
  if (!leadMinutes) return [];

  const now = getBeijingNow(new Date(nowTs));
  const log =
    settings.classReminderLog &&
    typeof settings.classReminderLog === 'object' &&
    !Array.isArray(settings.classReminderLog)
      ? settings.classReminderLog
      : {};

  return getClassesForDate(courses, settings, now.dateStr).filter((occurrence) => {
    if (log[occurrence.key]) return false;
    return (
      nowTs >= occurrence.startTs - leadMinutes * 60 * 1000 &&
      nowTs < occurrence.startTs
    );
  });
}

export function classReminderBody(occurrence) {
  return [
    `教室：${occurrence.session.location || '未填写'}`,
    `时间：${occurrence.startTime}-${occurrence.endTime}（第 ${occurrence.startPeriod}-${occurrence.endPeriod} 节）`,
    `日期：${formatMonthDay(occurrence.dateStr)} ${WEEKDAY_LABELS[weekdayIndex(occurrence.dateStr)]}`,
  ].join('\n');
}

export function pruneClassReminderLog(log, nowTs = Date.now()) {
  const cutoff = nowTs - 45 * 24 * 60 * 60 * 1000;
  const entries = Object.entries(log || {})
    .filter(([, at]) => Number.isFinite(Number(at)) && Number(at) >= cutoff)
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, 300);
  return Object.fromEntries(entries);
}

export function formatDuration(ms) {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
  }
  return `${minutes} 分钟`;
}
