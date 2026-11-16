const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 8 * 1024 * 1024;
function validateState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      !value.settings || typeof value.settings !== 'object' || Array.isArray(value.settings) ||
      !Array.isArray(value.courses) || !Array.isArray(value.assignments)) {
    throw new Error('数据结构不完整，未写入数据库');
  }
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) throw new Error('数据超过 8 MB 限制');
  const text = (v, field, empty = true) => {
    if (typeof v !== 'string' || (!empty && !v.trim())) throw new Error(`${field}无效`);
    return v;
  };
  const courseIds = new Set();
  const courses = value.courses.map((c, position) => {
    text(c.id, '课程编号', false);
    if (courseIds.has(c.id)) throw new Error('课程编号重复');
    courseIds.add(c.id);
    if (!Array.isArray(c.sessions)) throw new Error('上课安排必须是数组');
    const sessionIds = new Set();
    const sessions = c.sessions.map(s => {
      text(s.id, '上课安排编号', false);
      if (sessionIds.has(s.id)) throw new Error('上课安排编号重复');
      sessionIds.add(s.id);
      if (![s.day, s.start, s.end].every(Number.isInteger) || s.day < 1 || s.day > 7 ||
          s.start < 1 || s.end < s.start || s.end > 16) throw new Error('上课星期或节次无效');
      return { id: s.id, day: s.day, start: s.start, end: s.end,
        location: text(s.location ?? '', '教室'), weeks: s.weeks ?? null };
    });
    return { id: c.id, name: text(c.name, '课程名称', false), teacher: text(c.teacher ?? '', '教师'),
      type: c.type === 'lab' ? 'lab' : 'theory', archived: Boolean(c.archived),
      colorIndex: Number.isInteger(c.colorIndex) ? c.colorIndex : 0,
      note: text(c.note ?? '', '课程备注'), sessions };
  });
  const assignmentIds = new Set();
  const assignments = value.assignments.map(a => {
    text(a.id, '作业编号', false);
    if (assignmentIds.has(a.id)) throw new Error('作业编号重复');
    assignmentIds.add(a.id);
    if (a.courseId && !courseIds.has(a.courseId)) throw new Error('作业关联的课程不存在');
    if (a.reminderMinutes != null && (!Number.isInteger(a.reminderMinutes) || a.reminderMinutes <= 0)) {
      throw new Error('提醒提前量无效');
    }
    if (a.reminderNotifiedAt != null && !Number.isSafeInteger(a.reminderNotifiedAt)) throw new Error('提醒记录无效');
    return { id: a.id, courseId: a.courseId || null, title: text(a.title, '作业名称', false),
      notes: text(a.notes ?? '', '作业备注'), dueAt: text(a.dueAt ?? '', '截止时间'),
      status: a.status === 'done' ? 'done' : 'todo', reminderMinutes: a.reminderMinutes ?? null,
      reminderNotifiedAt: a.reminderNotifiedAt ?? null,
      createdAt: text(a.createdAt ?? '', '创建时间'), doneAt: a.doneAt ?? null };
  });
  return { settings: JSON.parse(JSON.stringify(value.settings)), courses, assignments };
}

function openDatabase(userDataDir) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const filename = path.join(userDataDir, 'coursepilot.db');
  const db = new DatabaseSync(filename);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) throw new Error('数据库由更新版本创建，请使用新版软件打开');
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')); db.exec('COMMIT'); }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } catch (error) { db.close(); throw error; }
  const meta = key => db.prepare('SELECT value FROM app_meta WHERE key=?').get(key)?.value;
  const putMeta = (key, value) => db.prepare('INSERT OR REPLACE INTO app_meta VALUES (?,?)').run(key, String(value));
  function read() {
    if (meta('initialized') !== '1') return null;
    const settings = JSON.parse(db.prepare('SELECT data FROM settings WHERE id=1').get().data);
    const courses = db.prepare('SELECT * FROM courses ORDER BY position').all().map(c => ({
      id: c.id, name: c.name, teacher: c.teacher, type: c.type, archived: !!c.archived,
      colorIndex: c.color_index, note: c.note,
      sessions: db.prepare('SELECT * FROM sessions WHERE course_id=? ORDER BY position').all(c.id).map(s => ({
        id: s.id, day: s.day, start: s.start, end: s.end, location: s.location, weeks: JSON.parse(s.weeks),
      })),
    }));
    const assignments = db.prepare('SELECT * FROM assignments ORDER BY position').all().map(a => ({
      id: a.id, courseId: a.course_id, title: a.title, notes: a.notes, dueAt: a.due_at, status: a.status,
      reminderMinutes: a.reminder_minutes, reminderNotifiedAt: a.reminder_notified_at,
      createdAt: a.created_at, doneAt: a.done_at,
    }));
    return { state: { settings, courses, assignments }, revision: Number(meta('revision')), path: filename };
  }
  function write(value, expectedRevision, migration = false) {
    const state = validateState(value);
    db.exec('BEGIN IMMEDIATE');
    try {
      const revision = Number(meta('revision') || 0);
      if (!migration && meta('initialized') !== '1') throw new Error('数据库尚未初始化');
      if (!migration && expectedRevision !== revision) throw new Error('数据版本已变化，请重新打开软件后重试');
      db.exec('DELETE FROM assignments; DELETE FROM sessions; DELETE FROM courses; DELETE FROM settings;');
      db.prepare('INSERT INTO settings VALUES (1,?)').run(JSON.stringify(state.settings));
      const insertCourse = db.prepare('INSERT INTO courses VALUES (?,?,?,?,?,?,?,?)');
      const insertSession = db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,?,?)');
      state.courses.forEach((c, i) => {
        insertCourse.run(c.id, c.name, c.teacher, c.type, Number(c.archived), c.colorIndex, c.note, i);
        c.sessions.forEach((s, j) => insertSession.run(c.id, s.id, s.day, s.start, s.end, s.location, JSON.stringify(s.weeks), j));
      });
      const insertAssignment = db.prepare('INSERT INTO assignments VALUES (?,?,?,?,?,?,?,?,?,?,?)');
      state.assignments.forEach((a, i) => insertAssignment.run(a.id, a.courseId, a.title, a.notes, a.dueAt,
        a.status, a.reminderMinutes, a.reminderNotifiedAt, a.createdAt, a.doneAt, i));
      putMeta('initialized', '1'); putMeta('revision', revision + 1);
      if (migration) putMeta('legacy_migration_completed', new Date().toISOString());
      db.exec('COMMIT');
      return read();
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  return {
    initialize({ initialState, legacyRaw, legacyError } = {}) {
      const existing = read();
      if (existing) return existing; // A cleared database must never re-import stale localStorage.
      if (legacyError) throw new Error(`旧数据无法迁移：${legacyError}；原数据已保留`);
      const state = validateState(initialState);
      if (legacyRaw != null) {
        if (typeof legacyRaw !== 'string' || Buffer.byteLength(legacyRaw) > MAX_BYTES) throw new Error('旧数据无效或过大');
        JSON.parse(legacyRaw);
        const backup = path.join(userDataDir, `localstorage-before-sqlite-${Date.now()}.json`);
        fs.writeFileSync(backup, legacyRaw, { flag: 'wx', mode: 0o600 });
      }
      return write(state, 0, true);
    },
    save: write,
    read,
    close() { db.close(); },
  };
}
module.exports = { openDatabase, validateState };
