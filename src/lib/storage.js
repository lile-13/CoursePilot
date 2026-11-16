import { addDays, getBeijingNow, weekdayIndex } from './time.js';
import { parseWeekText } from './weeks.js';
import { normalizeReminderMinutes } from './reminders.js';

export const STORAGE_KEY = 'coursepilot.data.v1';

export const DEFAULT_PERIOD_TIMES = [
  { start: '08:00', end: '08:45' },
  { start: '08:55', end: '09:40' },
  { start: '10:00', end: '10:45' },
  { start: '10:55', end: '11:40' },
  { start: '14:00', end: '14:45' },
  { start: '14:55', end: '15:40' },
  { start: '16:00', end: '16:45' },
  { start: '16:55', end: '17:40' },
  { start: '19:00', end: '19:45' },
  { start: '19:55', end: '20:40' },
  { start: '20:50', end: '21:35' },
  { start: '21:45', end: '22:30' },
];

export function defaultSettings() {
  const now = getBeijingNow();
  const monday = addDays(now.dateStr, -weekdayIndex(now.dateStr));
  return {
    semesterName: '当前学期',
    startDate: monday,
    totalWeeks: 20,
    periodsPerDay: DEFAULT_PERIOD_TIMES.length,
    periodTimes: DEFAULT_PERIOD_TIMES.map((item) => ({ ...item })),
  };
}

export function createEmptyState() {
  return {
    settings: defaultSettings(),
    courses: [],
    assignments: [],
  };
}

export function normalizeState(input) {
  if (!input || typeof input !== 'object') return createEmptyState();
  const settings = { ...defaultSettings(), ...(input.settings || {}) };
  settings.totalWeeks = Math.min(Math.max(Number(settings.totalWeeks) || 20, 1), 30);
  settings.periodsPerDay = Math.min(Math.max(Number(settings.periodsPerDay) || 12, 1), 16);
  const times = Array.isArray(settings.periodTimes) ? settings.periodTimes : [];
  settings.periodTimes = Array.from({ length: settings.periodsPerDay }, (_, index) => ({
    start: times[index]?.start || DEFAULT_PERIOD_TIMES[index]?.start || '08:00',
    end: times[index]?.end || DEFAULT_PERIOD_TIMES[index]?.end || '08:45',
  }));

  const courses = Array.isArray(input.courses)
    ? input.courses
        .filter((course) => course && course.name)
        .map((course, index) => ({
          id: course.id || `course_${index}`,
          name: String(course.name),
          teacher: course.teacher || '',
          type: course.type === 'lab' ? 'lab' : 'theory',
          archived: Boolean(course.archived),
          colorIndex: Number(course.colorIndex) || 0,
          note: course.note || '',
          sessions: (Array.isArray(course.sessions) ? course.sessions : [])
            .filter((session) => session && session.day && session.start)
            .map((session, sessionIndex) => ({
              id: session.id || `session_${index}_${sessionIndex}`,
              day: Math.min(Math.max(Number(session.day) || 1, 1), 7),
              start: Math.min(Math.max(Number(session.start) || 1, 1), 16),
              end: Math.min(Math.max(Number(session.end) || Number(session.start) || 1, 1), 16),
              location: session.location || '',
              // 旧版本把单双周套在整个表达式上；有原文时重新解析修复旧数据。
              weeks: session.weeks?.raw ? parseWeekText(session.weeks.raw) : session.weeks || null,
            })),
        }))
    : [];

  const assignments = Array.isArray(input.assignments)
    ? input.assignments
        .filter((item) => item && item.title)
        .map((item, index) => ({
          id: item.id || `assignment_${index}`,
          courseId: item.courseId || null,
          title: String(item.title),
          notes: item.notes || '',
          dueAt: item.dueAt || '',
          status: item.status === 'done' ? 'done' : 'todo',
          reminderMinutes: normalizeReminderMinutes(item.reminderMinutes),
          reminderNotifiedAt: item.reminderNotifiedAt || null,
          createdAt: item.createdAt || new Date().toISOString(),
          doneAt: item.doneAt || null,
        }))
    : [];

  return { settings, courses, assignments };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeState(JSON.parse(raw));
  } catch (error) {
    console.warn('读取本地数据失败', error);
    return null;
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.warn('保存本地数据失败', error);
    return false;
  }
}
