import { createId } from './id.js';
import { COURSE_COLOR_COUNT, nextColorIndex } from './classColors.js';
import { weeksKey } from './weeks.js';

const nameKey = (course) => `${course.name.trim()}|${course.type === 'lab' ? 'lab' : 'theory'}`;
const sameTeacher = (a, b) => (a.teacher || '').trim() === (b.teacher || '').trim();
const sessionKey = (session) =>
  `${session.day}|${session.start}|${session.end}|${session.location || ''}|${weeksKey(session.weeks)}`;

// 课表与待同步的设置在同一次状态更新中保存。
export function importCourses(current, imported, mode = 'merge', settingsPatch = {}) {
  const used = new Set();
  const startColor = nextColorIndex(current.courses);
  const courses = mode === 'replace' ? [] : [...current.courses];
  for (const [index, incoming] of imported.entries()) {
    const candidates = current.courses.filter(
      (course) => !used.has(course.id) && nameKey(course) === nameKey(incoming)
    );
    let existing = candidates.find((course) => sameTeacher(course, incoming));
    // 教师改变时，仅对两边均唯一的同名同类型课程复用身份。
    if (!existing && candidates.length === 1 &&
        imported.filter((course) => nameKey(course) === nameKey(incoming)).length === 1) {
      existing = candidates[0];
    }
    if (existing) used.add(existing.id);
    const oldSessions = new Map((existing?.sessions || []).map((session) => [sessionKey(session), session]));
    const sessions = new Map(mode === 'replace' ? [] : oldSessions);
    for (const session of incoming.sessions || []) {
      const key = sessionKey(session);
      if (!sessions.has(key)) {
        sessions.set(key, { ...session, id: oldSessions.get(key)?.id || session.id || createId('session') });
      }
    }
    const course = {
      ...incoming,
      id: existing?.id || createId('course'),
      teacher: incoming.teacher || '',
      type: incoming.type === 'lab' ? 'lab' : 'theory',
      colorIndex: existing?.colorIndex ?? incoming.colorIndex ?? (startColor + index) % COURSE_COLOR_COUNT,
      note: existing?.note || incoming.note || '',
      archived: false,
      sessions: [...sessions.values()],
    };
    const position = courses.findIndex((item) => item.id === course.id);
    if (position >= 0) courses[position] = course;
    else courses.push(course);
  }
  if (mode === 'replace') {
    const linkedIds = new Set(current.assignments.map((assignment) => assignment.courseId));
    for (const oldCourse of current.courses) {
      if (!used.has(oldCourse.id) && linkedIds.has(oldCourse.id)) {
        // 本次课表没有这门课时，保留作业关联，旧安排不再出现在周课表。
        courses.push({ ...oldCourse, archived: true, sessions: [] });
      }
    }
  }
  return { ...current, courses, settings: { ...current.settings, ...settingsPatch } };
}
