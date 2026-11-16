import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createEmptyState, loadState, normalizeState, saveState } from './lib/storage.js';
import { createId } from './lib/id.js';
import { nextColorIndex } from './lib/classColors.js';
import { importCourses } from './lib/importCourses.js';
import { createDemoState } from './lib/demo.js';
import { normalizeReminderMinutes } from './lib/reminders.js';

const StoreContext = createContext(null);

function prepareSessions(sessions) {
  return (sessions || []).map((session) => ({
    id: session.id || createId('session'),
    day: session.day,
    start: session.start,
    end: session.end,
    location: session.location || '',
    weeks: session.weeks || null,
  }));
}

export function StoreProvider({ children }) {
  const [state, setState] = useState(() => loadState() || createEmptyState());
  const [toast, setToast] = useState(null);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const notify = useCallback((message, tone = 'success') => {
    setToast({ id: createId('toast'), message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  const actions = useMemo(
    () => ({
      updateSettings(patch) {
        setState((current) => ({ ...current, settings: { ...current.settings, ...patch } }));
      },

      saveCourse(course) {
        setState((current) => {
          const exists = current.courses.some((item) => item.id === course.id);
          const colorIndex =
            typeof course.colorIndex === 'number' ? course.colorIndex : nextColorIndex(current.courses);
          const nextCourse = { ...course, colorIndex, sessions: prepareSessions(course.sessions) };
          const courses = exists
            ? current.courses.map((item) => (item.id === course.id ? nextCourse : item))
            : [...current.courses, nextCourse];
          return { ...current, courses };
        });
      },

      deleteCourse(courseId) {
        setState((current) => ({
          ...current,
          courses: current.courses.filter((course) => course.id !== courseId),
          assignments: current.assignments.map((assignment) =>
            assignment.courseId === courseId ? { ...assignment, courseId: null } : assignment
          ),
        }));
      },

      saveImportedCourses(importedCourses, mode = 'merge', settingsPatch = {}) {
        setState((current) => importCourses(current, importedCourses, mode, settingsPatch));
      },

      addAssignment(payload) {
        setState((current) => ({
          ...current,
          assignments: [
            ...current.assignments,
            {
              id: createId('assignment'),
              courseId: payload.courseId || null,
              title: payload.title,
              notes: payload.notes || '',
              dueAt: payload.dueAt,
              status: payload.status === 'done' ? 'done' : 'todo',
              reminderMinutes: normalizeReminderMinutes(payload.reminderMinutes),
              reminderNotifiedAt: null,
              createdAt: new Date().toISOString(),
              doneAt: payload.status === 'done' ? new Date().toISOString() : null,
            },
          ],
        }));
      },

      updateAssignment(id, patch) {
        setState((current) => ({
          ...current,
          assignments: current.assignments.map((assignment) => {
            if (assignment.id !== id) return assignment;
            const next = { ...assignment, ...patch };
            if (patch.reminderMinutes !== undefined) {
              next.reminderMinutes = normalizeReminderMinutes(patch.reminderMinutes);
            }
            const dueChanged =
              patch.dueAt !== undefined && patch.dueAt !== assignment.dueAt;
            const reminderChanged =
              patch.reminderMinutes !== undefined &&
              normalizeReminderMinutes(patch.reminderMinutes) !==
                normalizeReminderMinutes(assignment.reminderMinutes);
            if (dueChanged || reminderChanged) {
              next.reminderNotifiedAt = null;
            }
            if (patch.status) {
              next.doneAt =
                patch.status === 'done' ? assignment.doneAt || new Date().toISOString() : null;
            }
            return next;
          }),
        }));
      },

      toggleAssignment(id) {
        setState((current) => ({
          ...current,
          assignments: current.assignments.map((assignment) =>
            assignment.id === id
              ? {
                  ...assignment,
                  status: assignment.status === 'done' ? 'todo' : 'done',
                  doneAt:
                    assignment.status === 'done'
                      ? null
                      : new Date().toISOString(),
                }
              : assignment
          ),
        }));
      },

      deleteAssignment(id) {
        setState((current) => ({
          ...current,
          assignments: current.assignments.filter((assignment) => assignment.id !== id),
        }));
      },

      markAssignmentReminded(id, at = Date.now(), expected) {
        setState((current) => ({
          ...current,
          assignments: current.assignments.map((assignment) =>
            assignment.id === id && (!expected || (
              assignment.dueAt === expected.dueAt &&
              assignment.reminderMinutes === expected.reminderMinutes &&
              assignment.status !== 'done'
            )) ? { ...assignment, reminderNotifiedAt: at } : assignment
          ),
        }));
      },

      loadDemo() {
        setState(createDemoState());
      },

      replaceState(data) {
        setState(normalizeState(data));
      },

      resetAll() {
        setState(createEmptyState());
      },
    }),
    []
  );

  const value = useMemo(
    () => ({ state, settings: state.settings, courses: state.courses, assignments: state.assignments, actions, toast, notify }),
    [state, actions, toast, notify]
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore 必须在 StoreProvider 内使用');
  return context;
}
