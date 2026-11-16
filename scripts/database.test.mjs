import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { createEmptyState, normalizeState, normalizeStateForImport } from '../src/lib/storage.js';
const { openDatabase } = createRequire(import.meta.url)('../electron/database.cjs');

function fixture() {
  return normalizeState({ ...createEmptyState(),
    courses: [{ id: 'c1', name: '数据库测试课', colorIndex: 2, note: '保留备注', sessions: [
      { id: 's1', day: 1, start: 1, end: 2, location: 'A101', weeks: { raw: '4-6周(双),11周' } },
    ] }],
    assignments: [{ id: 'a1', courseId: 'c1', title: '测试作业', dueAt: '2026-11-20T12:00',
      reminderMinutes: 30, reminderNotifiedAt: 123456, status: 'todo', createdAt: '2026-11-16T12:00:00Z' }],
  });
}
function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), 'coursepilot-db-test-'));
  const handles = [];
  t.after(() => { for (const db of handles) try { db.close(); } catch {} rmSync(dir, { recursive: true, force: true }); });
  return { dir, open: () => { const db = openDatabase(dir); handles.push(db); return db; } };
}

test('坏备份和坏迁移数据不能在归一化时静默丢掉课程或上课安排', () => {
  const source = fixture(); source.courses[0].sessions[0].day = 0;
  assert.throws(() => normalizeStateForImport(source), /无效上课安排/);
  source.courses[0].sessions[0].day = 1;
  source.courses[0].sessions[0].weeks.raw = '无法识别';
  assert.throws(() => normalizeStateForImport(source), /无法识别的周次/);
  assert.equal(source.courses[0].sessions.length, 1);
});

test('SQLite 文件迁移、关系表与重启读取保留课程关联和已提醒记录', t => {
  const { dir, open } = temporary(t), source = fixture();
  const db = open(); const raw = JSON.stringify(source);
  const first = db.initialize({ initialState: source, legacyRaw: raw });
  assert.deepEqual(first.state, source);
  assert.equal(readFileSync(join(dir, 'coursepilot.db')).subarray(0, 15).toString(), 'SQLite format 3');
  const backup = readdirSync(dir).find(n => n.startsWith('localstorage-before-sqlite-'));
  assert.equal(readFileSync(join(dir, backup), 'utf8'), raw);
  db.close();
  assert.deepEqual(open().read(), first);
  const inspect = new DatabaseSync(join(dir, 'coursepilot.db'));
  assert.equal(inspect.prepare('SELECT count(*) AS n FROM sessions').get().n, 1);
  assert.equal(inspect.prepare('SELECT course_id FROM assignments').get().course_id, 'c1');
  inspect.close();
});

test('迁移仅一次，清空后重启不会复活旧 localStorage', t => {
  const { open } = temporary(t), db = open();
  const first = db.initialize({ initialState: fixture(), legacyRaw: JSON.stringify(fixture()) });
  const empty = db.save(createEmptyState(), first.revision);
  assert.equal(db.initialize({ initialState: fixture(), legacyError: '坏 JSON' }).state.courses.length, 0);
  db.close(); assert.deepEqual(open().read(), empty);
});

test('迁移无效数据会阻止初始化，不悄悄保存空数据，修正后可重试', t => {
  const { open } = temporary(t), db = open();
  assert.throws(() => db.initialize({ legacyError: 'JSON 损坏' }), /旧数据无法迁移/);
  assert.equal(db.read(), null);
  assert.throws(() => db.initialize({ initialState: fixture(), legacyRaw: '{' }), /JSON/);
  assert.equal(db.read(), null);
  assert.equal(db.initialize({ initialState: fixture() }).state.assignments.length, 1);
});

test('实际事务写入中途失败，覆盖操作整体回滚，课程和作业均保留', t => {
  const { dir, open } = temporary(t), db = open();
  const first = db.initialize({ initialState: fixture() });
  const inspect = new DatabaseSync(join(dir, 'coursepilot.db'));
  inspect.exec("CREATE TRIGGER test_failure BEFORE INSERT ON assignments BEGIN SELECT RAISE(ABORT,'模拟磁盘写入失败'); END;");
  const changed = structuredClone(first.state); changed.courses[0].name = '不可部分保存';
  assert.throws(() => db.save(changed, first.revision), /模拟磁盘写入失败/);
  assert.deepEqual(db.read(), first);
  inspect.exec('DROP TRIGGER test_failure'); inspect.close();
  assert.equal(db.save(changed, first.revision).state.courses[0].name, '不可部分保存');
});

test('拒绝失效版本、重复 ID 和悬空作业关联，不破坏原数据', t => {
  const { open } = temporary(t), db = open();
  const first = db.initialize({ initialState: fixture() });
  assert.throws(() => db.save(first.state, 0), /版本已变化/);
  const duplicate = structuredClone(first.state); duplicate.courses.push(duplicate.courses[0]);
  assert.throws(() => db.save(duplicate, first.revision), /编号重复/);
  const dangling = structuredClone(first.state); dangling.assignments[0].courseId = 'missing';
  assert.throws(() => db.save(dangling, first.revision), /关联的课程不存在/);
  assert.deepEqual(db.read(), first);
});
