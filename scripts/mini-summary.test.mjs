import test from 'node:test';
import assert from 'node:assert/strict';
import { beijingDateTimeToTs } from '../src/lib/classReminders.js';
import { formatDueShort, getMiniSummary } from '../src/lib/miniSummary.js';
import { parseWeekText } from '../src/lib/weeks.js';

const START_DATE = '2026-11-15'; // 周日，第 1 周 11/15 - 11/21
const MONDAY = '2026-11-16';
const TUESDAY = '2026-11-17';

function makeSettings(overrides = {}) {
  return {
    startDate: START_DATE,
    totalWeeks: 20,
    periodsPerDay: 12,
    periodTimes: [
      { start: '08:30', end: '09:15' },
      { start: '09:25', end: '10:10' },
      { start: '10:30', end: '11:15' },
      { start: '11:25', end: '12:10' },
    ],
    classReminderMinutes: 10,
    classReminderLog: {},
    ...overrides,
  };
}

const COURSES = [
  {
    id: 'c1',
    name: '高等数学',
    teacher: '张老师',
    type: 'theory',
    archived: false,
    colorIndex: 0,
    note: '',
    sessions: [{ id: 's1', day: 1, start: 1, end: 2, location: '教1-201', weeks: parseWeekText('1-16周') }],
  },
  {
    id: 'c2',
    name: '大学英语',
    teacher: '李老师',
    type: 'theory',
    archived: false,
    colorIndex: 1,
    note: '',
    sessions: [{ id: 's2', day: 2, start: 1, end: 2, location: '文A101', weeks: parseWeekText('1-16周') }],
  },
  {
    id: 'c3',
    name: '大学物理',
    teacher: '王老师',
    type: 'theory',
    archived: false,
    colorIndex: 2,
    note: '',
    sessions: [{ id: 's3', day: 2, start: 3, end: 4, location: '理B202', weeks: parseWeekText('2-16周(双)') }],
  },
];

function makeState(assignments) {
  return { settings: makeSettings(), courses: COURSES, assignments };
}

const ASSIGNMENTS = [
  {
    id: 'a1',
    courseId: 'c1',
    title: '高数习题',
    notes: '',
    dueAt: '2026-11-16T23:00',
    status: 'todo',
    reminderMinutes: 30,
    reminderNotifiedAt: null,
    createdAt: '2026-11-15T10:00',
    doneAt: null,
  },
  {
    id: 'a2',
    courseId: 'c2',
    title: '英语作文',
    notes: '',
    dueAt: '2026-11-17T09:00',
    status: 'todo',
    reminderMinutes: 60,
    reminderNotifiedAt: null,
    createdAt: '2026-11-15T11:00',
    doneAt: null,
  },
  {
    id: 'a3',
    courseId: 'c1',
    title: '上周作业',
    notes: '',
    dueAt: '2026-11-15T12:00',
    status: 'todo',
    reminderMinutes: null,
    reminderNotifiedAt: null,
    createdAt: '2026-11-14T09:00',
    doneAt: null,
  },
];

test('悬浮窗摘要：上课中显示当前课程和下课倒计时', () => {
  const summary = getMiniSummary(makeState(ASSIGNMENTS), beijingDateTimeToTs(MONDAY, '08:40'));
  assert.equal(summary.mode, 'current');
  assert.equal(summary.course.name, '高等数学');
  assert.equal(summary.course.location, '教1-201');
  assert.equal(summary.countdownText, '还有 1 小时 30 分钟下课');
  assert.equal(summary.todayClassCount, 1);
  assert.equal(summary.pendingCount, 3);
});

test('悬浮窗摘要：课前显示下一节课和开始倒计时', () => {
  const summary = getMiniSummary(makeState([]), beijingDateTimeToTs(MONDAY, '08:00'));
  assert.equal(summary.mode, 'next');
  assert.equal(summary.course.name, '高等数学');
  assert.equal(summary.course.startTime, '08:30');
  assert.equal(summary.countdownText, '还有 30 分钟开始');
});

test('悬浮窗摘要：课程结束后提示明天第一节课', () => {
  const summary = getMiniSummary(makeState([]), beijingDateTimeToTs(MONDAY, '12:30'));
  assert.equal(summary.mode, 'done');
  assert.equal(summary.course, null);
  assert.equal(summary.tomorrowHint, '明天 08:30 · 大学英语');
});

test('悬浮窗摘要：双周课在第 1 周不出现，第 2 周出现', () => {
  const firstWeek = getMiniSummary(makeState([]), beijingDateTimeToTs(TUESDAY, '10:20'));
  assert.deepEqual(
    firstWeek.course,
    null,
    '第 1 周周二 10:20 英语已结束，双周物理不出现'
  );
  assert.equal(firstWeek.mode, 'done');

  const secondWeek = getMiniSummary(makeState([]), beijingDateTimeToTs('2026-11-24', '10:20'));
  assert.equal(secondWeek.mode, 'next');
  assert.equal(secondWeek.course.name, '大学物理');
});

test('悬浮窗摘要：最近截止作业、逾期状态和待交数量', () => {
  const summary = getMiniSummary(makeState(ASSIGNMENTS), beijingDateTimeToTs(MONDAY, '08:40'));
  assert.equal(summary.nearest.title, '上周作业');
  assert.equal(summary.nearest.courseName, '高等数学');
  assert.equal(summary.nearest.overdue, true);
  assert.equal(summary.nearest.dueText, '已逾期 · 11月15日 12:00');

  const future = getMiniSummary(makeState(ASSIGNMENTS.slice(0, 2)), beijingDateTimeToTs(MONDAY, '08:40'));
  assert.equal(future.nearest.title, '高数习题');
  assert.equal(future.nearest.overdue, false);
  assert.equal(future.nearest.dueText, '今天 23:00');
});

test('悬浮窗摘要：没有设置或未加载时返回未就绪', () => {
  assert.deepEqual(getMiniSummary(null), { ready: false });
});

test('作业截止短文本：今天、明天、其他日期和无效值', () => {
  const now = beijingDateTimeToTs(MONDAY, '08:40');
  assert.equal(formatDueShort('2026-11-16T23:00', now, MONDAY), '今天 23:00');
  assert.equal(formatDueShort('2026-11-17T09:00', now, MONDAY), '明天 09:00');
  assert.equal(formatDueShort('2026-11-20T09:00', now, MONDAY), '11月20日 09:00');
  assert.equal(formatDueShort('', now, MONDAY), '未设置截止');
});
