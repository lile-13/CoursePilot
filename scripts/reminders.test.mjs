import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDueAt,
  getDueReminders,
  getReminderLabel,
  normalizeReminderMinutes,
  parseDueAt,
} from '../src/lib/reminders.js';

const DUE = '2026-11-16T12:00';
const DUE_TS = Date.UTC(2026, 10, 16, 4, 0);

function assignment(overrides = {}) {
  return {
    id: 'a1',
    title: '第三章习题',
    courseId: 'c1',
    dueAt: DUE,
    status: 'todo',
    reminderMinutes: 30,
    reminderNotifiedAt: null,
    ...overrides,
  };
}

test('北京时间截止时间正确转换为时间戳', () => {
  assert.equal(parseDueAt(DUE), DUE_TS);
  assert.equal(formatDueAt(DUE), '2026年11月16日 12:00');
});

test('到达提前 30 分钟且未完成时提醒', () => {
  const now = DUE_TS - 20 * 60 * 1000;
  assert.equal(getDueReminders([assignment()], now).length, 1);
});

test('还没到提醒时间不提醒', () => {
  const now = DUE_TS - 40 * 60 * 1000;
  assert.equal(getDueReminders([assignment()], now).length, 0);
});

test('已完成、已提醒、关闭提醒、已过截止时间都不提醒', () => {
  const now = DUE_TS - 10 * 60 * 1000;
  assert.equal(getDueReminders([assignment({ status: 'done' })], now).length, 0);
  assert.equal(getDueReminders([assignment({ reminderNotifiedAt: now - 1000 })], now).length, 0);
  assert.equal(getDueReminders([assignment({ reminderMinutes: null })], now).length, 0);
  assert.equal(getDueReminders([assignment()], DUE_TS + 1000).length, 0);
});

test('提前 1 天提醒按 24 小时窗口判断', () => {
  const due = '2026-11-17T12:00';
  const dueTs = Date.UTC(2026, 10, 17, 4, 0);
  assert.equal(
    getDueReminders([assignment({ dueAt: due, reminderMinutes: 1440 })], dueTs - 23 * 60 * 60 * 1000)
      .length,
    1
  );
  assert.equal(
    getDueReminders([assignment({ dueAt: due, reminderMinutes: 1440 })], dueTs - 25 * 60 * 60 * 1000)
      .length,
    0
  );
});

test('提醒选项与标签', () => {
  assert.equal(normalizeReminderMinutes('30'), 30);
  assert.equal(normalizeReminderMinutes(0), null);
  assert.equal(normalizeReminderMinutes(-1), null);
  assert.equal(getReminderLabel(60), '提前 1 小时');
  assert.equal(getReminderLabel(30), '提前 30 分钟');
  assert.equal(getReminderLabel(1440), '提前 1 天');
});
