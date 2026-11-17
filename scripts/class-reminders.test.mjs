import test from 'node:test';
import assert from 'node:assert/strict';
import {
  beijingDateTimeToTs,
  classReminderBody,
  formatDuration,
  getClassesForDate,
  getDueClassReminders,
  normalizeClassReminderMinutes,
  pruneClassReminderLog,
} from '../src/lib/classReminders.js';
import { parseWeekText } from '../src/lib/weeks.js';

const START_DATE = '2026-11-15'; // 周日，第 1 周 11/15 - 11/21
const TUESDAY = '2026-11-17';
const NEXT_TUESDAY = '2026-11-24';

function settings(overrides = {}) {
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

function course(overrides = {}) {
  return {
    id: 'c1',
    name: '数据结构与算法',
    teacher: '张老师',
    type: 'theory',
    archived: false,
    colorIndex: 0,
    note: '',
    sessions: [
      {
        id: 's1',
        day: 2,
        start: 1,
        end: 2,
        location: '信息A101',
        weeks: parseWeekText('1-16周'),
      },
      {
        id: 's2',
        day: 2,
        start: 3,
        end: 4,
        location: '信息A102',
        weeks: parseWeekText('2-16周(双)'),
      },
    ],
    ...overrides,
  };
}

test('按日期和周次返回当天课程，周二第 1 周只返回单周课', () => {
  const classes = getClassesForDate([course()], settings(), TUESDAY);
  assert.equal(classes.length, 1);
  assert.equal(classes[0].course.name, '数据结构与算法');
  assert.equal(classes[0].startTime, '08:30');
  assert.equal(classes[0].endTime, '10:10');
  assert.equal(classes[0].startPeriod, 1);
  assert.equal(classes[0].endPeriod, 2);
});

test('第 2 周同时返回普通课和双周课', () => {
  const classes = getClassesForDate([course()], settings(), NEXT_TUESDAY);
  assert.equal(classes.length, 2);
  assert.deepEqual(classes.map((item) => item.session.id), ['s1', 's2']);
});

test('归档课程和停用周次不返回', () => {
  assert.equal(
    getClassesForDate([course({ archived: true })], settings(), TUESDAY).length,
    0
  );
  assert.equal(
    getClassesForDate(
      [course({ sessions: [{ ...course().sessions[0], weeks: parseWeekText('2-16周') }] })],
      settings(),
      TUESDAY
    ).length,
    0
  );
});

test('提前 10 分钟窗口内提醒，窗口外和上课后不提醒', () => {
  const startTs = beijingDateTimeToTs(TUESDAY, '08:30');
  const dueAt = startTs - 5 * 60 * 1000;
  assert.equal(getDueClassReminders([course()], settings(), dueAt).length, 1);

  assert.equal(
    getDueClassReminders([course()], settings(), startTs - 11 * 60 * 1000).length,
    0
  );
  assert.equal(getDueClassReminders([course()], settings(), startTs).length, 0);
});

test('关闭提醒、已提醒记录和完成周次不重复提醒', () => {
  const startTs = beijingDateTimeToTs(TUESDAY, '08:30');
  const dueAt = startTs - 5 * 60 * 1000;
  assert.equal(
    getDueClassReminders([course()], settings({ classReminderMinutes: 0 }), dueAt).length,
    0
  );

  const [occurrence] = getClassesForDate([course()], settings(), TUESDAY);
  assert.equal(
    getDueClassReminders(
      [course()],
      settings({ classReminderLog: { [occurrence.key]: Date.now() } }),
      dueAt
    ).length,
    0
  );
});

test('提醒正文包含教室、节次时间和日期', () => {
  const [occurrence] = getClassesForDate([course()], settings(), TUESDAY);
  const body = classReminderBody(occurrence);
  assert.match(body, /信息A101/);
  assert.match(body, /08:30-10:10/);
  assert.match(body, /11月17日/);
});

test('提醒提前量只接受预设值，默认 10 分钟', () => {
  assert.equal(normalizeClassReminderMinutes(5), 5);
  assert.equal(normalizeClassReminderMinutes('15'), 15);
  assert.equal(normalizeClassReminderMinutes(0), 0);
  assert.equal(normalizeClassReminderMinutes(undefined), 10);
  assert.equal(normalizeClassReminderMinutes(7), 10);
});

test('倒计时格式与提醒日志裁剪', () => {
  assert.equal(formatDuration(25 * 60 * 1000), '25 分钟');
  assert.equal(formatDuration(75 * 60 * 1000), '1 小时 15 分钟');
  const now = Date.now();
  const log = {
    fresh: now,
    old: now - 60 * 24 * 60 * 60 * 1000,
  };
  assert.deepEqual(Object.keys(pruneClassReminderLog(log, now)), ['fresh']);
});
