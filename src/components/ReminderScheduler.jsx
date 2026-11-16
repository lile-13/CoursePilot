import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store.jsx';
import { formatDueAt, getDueReminders } from '../lib/reminders.js';

const CHECK_INTERVAL = 30 * 1000;

/**
 * 只在桌面端运行：定期检查未完成作业，到提醒时间调用 Electron 通知。
 * 已通知的作业写入 reminderNotifiedAt，重启后也不会重复弹。
 */
export default function ReminderScheduler() {
  const { assignments, courses, actions, notify } = useStore();
  const inFlightRef = useRef(new Set());
  const retryAfterRef = useRef(new Map());
  const warnedRef = useRef(new Set());
  const courseMap = useMemo(
    () => new Map(courses.map((course) => [course.id, course])),
    [courses]
  );

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.coursepilotDesktop : null;
    if (!api?.notify) return undefined;

    const check = () => {
      const due = getDueReminders(assignments, Date.now());
      for (const assignment of due) {
        if (inFlightRef.current.has(assignment.id)) continue;
        if ((retryAfterRef.current.get(assignment.id) || 0) > Date.now()) continue;
        inFlightRef.current.add(assignment.id);

        const course = courseMap.get(assignment.courseId);
        const body = [
          `课程：${course?.name || '未关联课程'}`,
          `截止：${formatDueAt(assignment.dueAt)}`,
        ].join('\n');

        const failed = (error) => {
          retryAfterRef.current.set(assignment.id, Date.now() + 60000);
          if (!warnedRef.current.has(assignment.id)) {
            warnedRef.current.add(assignment.id);
            notify(`桌面提醒未发送成功，将稍后重试：${error || '请检查 Windows 通知设置'}`, 'error');
          }
        };
        Promise.resolve().then(() =>
          api.notify({
            title: `作业截止提醒：${assignment.title}`,
            body,
            assignmentId: assignment.id,
          })
        )
          .then(async (result) => {
            if (result?.ok) {
              retryAfterRef.current.delete(assignment.id);
              warnedRef.current.delete(assignment.id);
              const saved = await actions.markAssignmentReminded(assignment.id, Date.now(), {
                dueAt: assignment.dueAt, reminderMinutes: assignment.reminderMinutes,
              });
              if (!saved) failed('通知已显示，但提醒记录保存失败');
            } else failed(result?.error);
          })
          .catch((error) => {
            console.warn('[CoursePilot] 发送作业提醒失败', error);
            failed(error.message);
          })
          .finally(() => {
            inFlightRef.current.delete(assignment.id);
          });
      }
    };

    check();
    const timer = window.setInterval(check, CHECK_INTERVAL);
    return () => window.clearInterval(timer);
  }, [assignments, courses, courseMap, actions, notify]);

  return null;
}
