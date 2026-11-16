export const BEIJING_TZ = 'Asia/Shanghai';

export const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export const WEEKDAY_FULL = ['星期一', '星期二', '星期三', '星期四', '星期五', '星期六', '星期日'];

const DAY_MS = 24 * 60 * 60 * 1000;

const beijingFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: BEIJING_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function pad2(value) {
  return String(value).padStart(2, '0');
}

export function dateToStr(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

export function parseDateStr(dateStr) {
  const [year, month, day] = String(dateStr).split('-').map(Number);
  return { year, month, day };
}

export function dateStrToUTC(dateStr) {
  const { year, month, day } = parseDateStr(dateStr);
  return Date.UTC(year, month - 1, day);
}

export function addDays(dateStr, amount) {
  const date = new Date(dateStrToUTC(dateStr) + amount * DAY_MS);
  return dateToStr(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function diffDays(fromDateStr, toDateStr) {
  return Math.round((dateStrToUTC(toDateStr) - dateStrToUTC(fromDateStr)) / DAY_MS);
}

/** 0 = 周一, 6 = 周日 */
export function weekdayIndex(dateStr) {
  return (new Date(dateStrToUTC(dateStr)).getUTCDay() + 6) % 7;
}

/** 获取北京时间（不受本机时区影响） */
export function getBeijingNow(date = new Date()) {
  const parts = {};
  for (const part of beijingFormatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hh = Number(parts.hour);
  const mm = Number(parts.minute);
  const ss = Number(parts.second);
  const dateStr = dateToStr(year, month, day);
  return {
    year,
    month,
    day,
    dateStr,
    hh,
    mm,
    ss,
    timeText: `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`,
    minutes: hh * 60 + mm,
    weekday: weekdayIndex(dateStr),
  };
}

export function formatMonthDay(dateStr) {
  const { month, day } = parseDateStr(dateStr);
  return `${month}月${day}日`;
}

export function formatFullDate(dateStr) {
  const { year, month, day } = parseDateStr(dateStr);
  return `${year}年${month}月${day}日`;
}

export function formatShortDate(dateStr) {
  const { month, day } = parseDateStr(dateStr);
  return `${pad2(month)}/${pad2(day)}`;
}

export function weekdayLabel(dateStr) {
  return WEEKDAY_LABELS[weekdayIndex(dateStr)];
}

/** 学期信息：以选定的“第一周第一天”为基准计算当前周次，不限定周一 */
export function getSemesterInfo(startDate, totalWeeks, todayStr) {
  const todayWeekday = weekdayIndex(todayStr);
  const start = startDate || todayStr;
  const total = Number(totalWeeks) || 20;
  const daysFromStart = diffDays(start, todayStr);
  const rawWeek = Math.floor(daysFromStart / 7) + 1;
  let status = 'ongoing';
  if (rawWeek < 1) status = 'before';
  else if (rawWeek > total) status = 'after';
  const weekNumber = Math.min(Math.max(rawWeek, 1), total);
  const semesterWeekStart = addDays(start, (weekNumber - 1) * 7);
  return {
    weekday: todayWeekday,
    weekStart: semesterWeekStart,
    weekEnd: addDays(semesterWeekStart, 6),
    dayInWeek: diffDays(semesterWeekStart, todayStr),
    daysFromStart,
    weekNumber,
    rawWeek,
    totalWeeks: total,
    status,
    semesterWeekStart,
    semesterWeekEnd: addDays(semesterWeekStart, 6),
    parity: weekNumber % 2 === 1 ? 'odd' : 'even',
  };
}

export function getWeekRange(startDate, week) {
  const start = addDays(startDate, (week - 1) * 7);
  return { start, end: addDays(start, 6) };
}

/** 按“第一周第一天”的星期，返回 7 天的课程 day 值顺序（1=周一 … 7=周日） */
export function weekOrderFromStartDate(startDate) {
  const startDayIndex = weekdayIndex(startDate);
  return Array.from({ length: 7 }, (_, index) => ((startDayIndex + index) % 7) + 1);
}

/** 课表第 week 周、显示顺序第 index 天对应的日期 */
export function dateForDisplayIndex(startDate, week, displayIndex) {
  return addDays(startDate, (week - 1) * 7 + displayIndex);
}

export function timeTextToMinutes(timeText) {
  if (!timeText) return null;
  const [hh, mm] = String(timeText).split(':').map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}
