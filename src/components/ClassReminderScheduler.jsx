import { useEffect, useRef } from 'react';
import { useStore } from '../store.jsx';
import {
  classReminderBody,
  getDueClassReminders,
} from '../lib/classReminders.js';

const CHECK_INTERVAL = 30 * 1000;

/**
 * 只在桌面端运行：上课前按设置提前量弹 Windows 通知。
 * 每次上课记录写入 settings.classReminderLog，避免同一节课重复提醒。
 */
export default function ClassReminderScheduler() {
  const { courses, settings, actions } = useStore();
  const inFlightRef = useRef(new Set());

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.coursepilotDesktop : null;
    if (!api?.notify) return undefined;

    const check = () => {
      const due = getDueClassReminders(courses, settings, Date.now());
      for (const occurrence of due) {
        if (inFlightRef.current.has(occurrence.key)) continue;
        inFlightRef.current.add(occurrence.key);

        Promise.resolve(
          api.notify({
            title: `上课提醒：${occurrence.course.name}`,
            body: classReminderBody(occurrence),
            target: 'today',
            classKey: occurrence.key,
          })
        )
          .then((result) => {
            if (result?.ok) actions.markClassReminded(occurrence.key);
          })
          .catch((error) => {
            console.warn('[CoursePilot] 发送上课提醒失败', error);
          })
          .finally(() => {
            inFlightRef.current.delete(occurrence.key);
          });
      }
    };

    check();
    const timer = window.setInterval(check, CHECK_INTERVAL);
    return () => window.clearInterval(timer);
  }, [courses, settings, actions]);

  return null;
}
