export const REMINDER_OPTIONS = [
  { value: 0, label: '关闭提醒' },
  { value: 30, label: '提前 30 分钟' },
  { value: 60, label: '提前 1 小时' },
  { value: 1440, label: '提前 1 天' },
];

export function normalizeReminderMinutes(value) {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.round(minutes);
}

export function getReminderLabel(minutes) {
  const normalized = normalizeReminderMinutes(minutes);
  if (!normalized) return '关闭提醒';
  const option = REMINDER_OPTIONS.find((item) => item.value === normalized);
  return option ? option.label : `提前 ${normalized} 分钟`;
}

/**
 * dueAt 存的是北京时间 `YYYY-MM-DDTHH:mm`，转成真实 UTC 时间戳。
 */
export function parseDueAt(dueAt) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(dueAt || ''));
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - 8,
    Number(minute)
  );
}

export function formatDueAt(dueAt) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(dueAt || ''));
  if (!match) return dueAt || '未设置';
  const [, year, month, day, hour, minute] = match;
  return `${year}年${Number(month)}月${Number(day)}日 ${hour}:${minute}`;
}

export function getReminderAt(assignment) {
  const minutes = normalizeReminderMinutes(assignment?.reminderMinutes);
  const due = parseDueAt(assignment?.dueAt);
  if (!minutes || !due) return null;
  return due - minutes * 60 * 1000;
}

/**
 * 返回当前应该提醒的作业：未完成、提醒已到、尚未提醒、截止时间还没过。
 */
export function getDueReminders(assignments, nowTs = Date.now()) {
  return (assignments || []).filter((assignment) => {
    if (!assignment || assignment.status === 'done' || assignment.reminderNotifiedAt) {
      return false;
    }
    const reminderAt = getReminderAt(assignment);
    const dueAt = parseDueAt(assignment.dueAt);
    if (reminderAt == null || dueAt == null) return false;
    return nowTs >= reminderAt && nowTs < dueAt;
  });
}
