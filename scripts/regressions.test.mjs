import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWeekText, isWeekActive, formatWeeks } from '../src/lib/weeks.js';
import { importCourses } from '../src/lib/importCourses.js';
import { normalizeState } from '../src/lib/storage.js';

const activeWeeks = (weeks) => Array.from({ length: 40 }, (_, i) => i + 1).filter((week) => isWeekActive(weeks, week));
const session = () => ({ id: 'slot-old', day: 4, start: 5, end: 6, location: '虚构楼A101', weeks: parseWeekText('4-6周(双),11周') });
const course = (extra = {}) => ({ id: 'course-old', name: '虚构课程甲', type: 'theory', teacher: '示例教师', colorIndex: 2, note: '自己的备注', sessions: [session()], ...extra });
const initial = () => ({ settings: { periodsPerDay: 12 }, courses: [course()], assignments: [{ id: 'task-1', courseId: 'course-old', title: '示例作业' }] });

test('混合单双周按片段判断，保留第11周，显示文本往返不丢周次', () => {
  const weeks = parseWeekText('4-6周(双),11周');
  assert.deepEqual(activeWeeks(weeks), [4, 6, 11]);
  assert.deepEqual(activeWeeks(parseWeekText(formatWeeks(weeks))), [4, 6, 11]);
  assert.deepEqual(activeWeeks(parseWeekText('2-10周（双），5周')), [2, 4, 5, 6, 8, 10]);
});

test('省略周字的同组范围保留尾部单双周规则，不连续周次不补齐', () => {
  assert.deepEqual(activeWeeks(parseWeekText('1-8,10-16周(单)')), [1, 3, 5, 7, 11, 13, 15]);
  assert.deepEqual(activeWeeks(parseWeekText('1-3周,5周,8-9周')), [1, 2, 3, 5, 8, 9]);
});

test('错误或部分无法识别的周次不会当作解析成功', () => {
  for (const raw of ['', '0周', '8-3周', '41周', '1-8周(隔周)', '1-8周,待定']) {
    assert.equal(parseWeekText(raw), null, raw);
  }
});

test('加载旧数据时按保留的周次原文修复全局单双周错误', () => {
  const old = initial();
  old.courses[0].sessions[0].weeks = { ranges: [[4, 6], [11, 11]], parity: 'even', raw: '4-6周(双),11周' };
  assert.deepEqual(activeWeeks(normalizeState(old).courses[0].sessions[0].weeks), [4, 6, 11]);
});

test('覆盖导入复用课程和时段ID，原作业关联、配色及备注保留', () => {
  const old = initial();
  const snapshot = JSON.stringify(old);
  const result = importCourses(old, [course({ id: undefined })], 'replace');
  assert.equal(result.courses[0].id, 'course-old');
  assert.equal(result.courses[0].sessions[0].id, 'slot-old');
  assert.equal(result.assignments[0].courseId, result.courses[0].id);
  assert.equal(result.courses[0].note, '自己的备注');
  assert.equal(JSON.stringify(old), snapshot, '不直接修改已有状态');
});

test('缺失但有作业的课程归档保留关联，重启仍保留，再次导入可恢复', () => {
  const result = importCourses(initial(), [], 'replace');
  assert.equal(result.courses[0].archived, true);
  assert.deepEqual(result.courses[0].sessions, []);
  const restored = normalizeState(JSON.parse(JSON.stringify(result)));
  assert.equal(restored.courses[0].archived, true);
  assert.equal(restored.assignments[0].courseId, restored.courses[0].id);
  const reimported = importCourses(restored, [course()], 'merge');
  assert.equal(reimported.courses.length, 1);
  assert.equal(reimported.courses[0].archived, false);
  assert.equal(reimported.courses[0].id, 'course-old');
  assert.equal(reimported.courses[0].sessions.length, 1);
});

test('唯一同名课程更换教师仍保持关联，理论和实验不会互相覆盖', () => {
  const result = importCourses(initial(), [course({ teacher: '新教师' }), course({ type: 'lab', sessions: [] })], 'replace');
  assert.equal(result.courses.length, 2);
  assert.equal(result.courses.find((item) => item.type === 'theory').id, 'course-old');
  assert.notEqual(result.courses.find((item) => item.type === 'lab').id, 'course-old');
});

test('重复合并不新增同一时段，不同地点的信息保留，设置随确认一起写入', () => {
  let result = importCourses(initial(), [course()], 'merge', { periodsPerDay: 8 });
  result = importCourses(result, [course()], 'merge');
  assert.equal(result.courses.length, 1);
  assert.equal(result.courses[0].sessions.length, 1);
  assert.equal(result.settings.periodsPerDay, 8);
  result = importCourses(result, [course({ sessions: [{ ...session(), location: '虚构楼B202' }] })], 'merge');
  assert.equal(result.courses[0].sessions.length, 2);
});
