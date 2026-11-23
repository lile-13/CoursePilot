import { addDays, getBeijingNow, weekdayIndex } from './time.js';
import { parseWeekText } from './weeks.js';
import { normalizeReminderMinutes } from './reminders.js';
import { normalizeClassReminderMinutes } from './classReminders.js';
import { isMaterialExt, normalizeMaterialExt } from './materials.js';

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
    classReminderMinutes: 10,
    classReminderLog: {},
  };
}

export function createEmptyState() {
  return {
    settings: defaultSettings(),
    courses: [],
    materials: [],
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
  settings.classReminderMinutes = normalizeClassReminderMinutes(settings.classReminderMinutes);
  settings.classReminderLog =
    settings.classReminderLog &&
    typeof settings.classReminderLog === 'object' &&
    !Array.isArray(settings.classReminderLog)
      ? settings.classReminderLog
      : {};

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

  const courseIds = new Set(courses.map((course) => course.id));
  const materials = Array.isArray(input.materials)
    ? input.materials
        .filter((item) => {
          if (!item || typeof item !== 'object') return false;
          const storedPath = String(item.storedPath || '');
          return Boolean(
            item.id &&
              item.courseId &&
              courseIds.has(item.courseId) &&
              item.originalName &&
              storedPath &&
              isMaterialExt(item.ext) &&
              !/^([a-zA-Z]:[\\/]|[\\/])/.test(storedPath) &&
              !storedPath.split(/[\\/]/).includes('..')
          );
        })
        .map((item) => ({
          id: String(item.id),
          courseId: item.courseId,
          originalName: String(item.originalName),
          storedPath: String(item.storedPath),
          ext: normalizeMaterialExt(item.ext),
          mime: String(item.mime || ''),
          size: Math.max(0, Number(item.size) || 0),
          addedAt: item.addedAt || new Date().toISOString(),
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

  return { settings, courses, materials, assignments };
}

// Imports and migrations must not silently drop malformed records during normalization.
export function normalizeStateForImport(input) {
  if (!input || !input.settings || typeof input.settings !== 'object' || Array.isArray(input.settings) ||
      !Array.isArray(input.courses) || !Array.isArray(input.assignments)) throw new Error('数据结构不完整');
  for (const course of input.courses) {
    if (typeof course?.name !== 'string' || !course.name.trim() || !Array.isArray(course.sessions)) {
      throw new Error('存在不完整的课程记录');
    }
    for (const session of course.sessions) {
      const day = Number(session?.day), start = Number(session?.start), end = Number(session?.end);
      if (![day, start, end].every(Number.isInteger) || day < 1 || day > 7 || start < 1 || end < start || end > 16) {
        throw new Error('存在无效上课安排，未丢弃任何记录');
      }
      if (session.weeks?.raw && !parseWeekText(session.weeks.raw)) throw new Error('存在无法识别的周次，原数据已保留');
    }
  }
  if (input.assignments.some(a => typeof a?.title !== 'string' || !a.title.trim())) {
    throw new Error('存在不完整的作业记录');
  }
  if (input.materials !== undefined) {
    if (!Array.isArray(input.materials)) throw new Error('课件数据必须是数组');
    const courseIds = new Set(input.courses.map((course) => course.id).filter(Boolean));
    for (const material of input.materials) {
      if (
        !material ||
        typeof material.id !== 'string' ||
        typeof material.courseId !== 'string' ||
        typeof material.originalName !== 'string' ||
        typeof material.storedPath !== 'string' ||
        !material.storedPath ||
        !isMaterialExt(material.ext)
      ) {
        throw new Error('存在不完整的课件记录');
      }
      if (!courseIds.has(material.courseId)) throw new Error('课件关联的课程不存在');
      if (
        /^([a-zA-Z]:[\\/]|[\\/])/.test(material.storedPath) ||
        material.storedPath.split(/[\\/]/).includes('..')
      ) {
        throw new Error('存在无效的课件路径');
      }
    }
  }
  return normalizeState(input);
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
