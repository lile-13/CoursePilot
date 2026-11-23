import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createEmptyState, normalizeStateForImport } from './lib/storage.js';
import { createId } from './lib/id.js';
import { nextColorIndex } from './lib/classColors.js';
import { importCourses } from './lib/importCourses.js';
import { createDemoState } from './lib/demo.js';
import { normalizeReminderMinutes } from './lib/reminders.js';
import {
  normalizeClassReminderMinutes,
  pruneClassReminderLog,
} from './lib/classReminders.js';
import { createPersistence } from './lib/persistence.js';

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

export function StoreProvider({ children, allowLegacyMigration = true }) {
  const desktop = typeof window !== 'undefined' && window.coursepilotDesktop?.isDesktop
    ? window.coursepilotDesktop : null;
  const [state, updateView] = useState(null);
  const [storageError, setStorageError] = useState('');
  const [loading, setLoading] = useState(true);
  const [databasePath, setDatabasePath] = useState('');
  const persistenceRef = useRef(null);
  if (!persistenceRef.current) persistenceRef.current = createPersistence({
    desktop,
    allowLegacyMigration,
    onState: value => { updateView(value); setStorageError(''); },
    onError: setStorageError,
  });
  const persistence = persistenceRef.current;
  const setState = useCallback((update) => persistence.commit(update), [persistence]);
  const [toast, setToast] = useState(null);

  const initialize = useCallback(async () => {
    setLoading(true); setStorageError('');
    try {
      const result = await persistence.initialize();
      updateView(result.state); setDatabasePath(result.path);
    } catch (error) { setStorageError(error.message); }
    finally { setLoading(false); }
  }, [persistence]);
  useEffect(() => {
    initialize();
  }, [initialize]);

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
        const nextPatch = { ...patch };
        if (patch.classReminderMinutes !== undefined) {
          nextPatch.classReminderMinutes = normalizeClassReminderMinutes(patch.classReminderMinutes);
        }
        return setState((current) => ({
          ...current,
          settings: { ...current.settings, ...nextPatch },
        }));
      },

      saveCourse(course) {
        return setState((current) => {
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
        return setState((current) => ({
          ...current,
          courses: current.courses.filter((course) => course.id !== courseId),
          materials: (current.materials || []).filter((material) => material.courseId !== courseId),
          assignments: current.assignments.map((assignment) =>
            assignment.courseId === courseId ? { ...assignment, courseId: null } : assignment
          ),
        }));
      },

      addMaterials(courseId, items) {
        if (!Array.isArray(items) || items.length === 0) return Promise.resolve(true);
        return setState((current) => {
          if (!current.courses.some((course) => course.id === courseId)) return current;
          const existingIds = new Set((current.materials || []).map((material) => material.id));
          const added = items
            .filter((item) => item && item.originalName && item.storedPath && item.ext)
            .map((item) => ({
              id: item.id && !existingIds.has(item.id) ? item.id : createId('material'),
              courseId,
              originalName: String(item.originalName),
              storedPath: String(item.storedPath),
              ext: String(item.ext).replace(/^\./, '').toLowerCase(),
              mime: String(item.mime || ''),
              size: Math.max(0, Number(item.size) || 0),
              addedAt: item.addedAt || new Date().toISOString(),
            }));
          return { ...current, materials: [...(current.materials || []), ...added] };
        });
      },

      removeMaterial(id) {
        return setState((current) => ({
          ...current,
          materials: (current.materials || []).filter((material) => material.id !== id),
        }));
      },

      saveImportedCourses(importedCourses, mode = 'merge', settingsPatch = {}) {
        return setState((current) => importCourses(current, importedCourses, mode, settingsPatch));
      },

      addAssignment(payload) {
        return setState((current) => ({
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
        return setState((current) => ({
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
        return setState((current) => ({
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
        return setState((current) => ({
          ...current,
          assignments: current.assignments.filter((assignment) => assignment.id !== id),
        }));
      },

      markAssignmentReminded(id, at = Date.now(), expected) {
        return setState((current) => ({
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

      markClassReminded(key, at = Date.now()) {
        return setState((current) => ({
          ...current,
          settings: {
            ...current.settings,
            classReminderMinutes: normalizeClassReminderMinutes(
              current.settings.classReminderMinutes
            ),
            classReminderLog: pruneClassReminderLog(
              { ...(current.settings.classReminderLog || {}), [key]: at },
              at
            ),
          },
        }));
      },

      loadDemo() {
        return setState(createDemoState());
      },

      replaceState(data) {
        return setState(normalizeStateForImport(data));
      },

      resetAll() {
        return setState(createEmptyState());
      },
    }),
    [setState]
  );

  const value = useMemo(
    () => ({ state, settings: state?.settings, courses: state?.courses, materials: state?.materials || [], assignments: state?.assignments, actions, toast, notify, databasePath, storageKind: desktop ? 'sqlite' : 'localStorage' }),
    [state, actions, toast, notify, databasePath, desktop]
  );

  if (!state) return <div className="page" role="alert">
    <h1>{loading ? '正在读取本机数据…' : '数据读取失败'}</h1>
    {storageError && <p>{storageError}。原数据未清空，请检查磁盘空间和目录权限后重试。</p>}
    {!loading && <button className="btn btn-primary" onClick={initialize}>重试读取</button>}
  </div>;
  return <StoreContext.Provider value={value}>
    {storageError && <div className="storage-error" role="alert">
      保存失败：{storageError}。本次更改未保存，请重试；原有数据保持不变。
      <button onClick={() => setStorageError('')}>关闭提示</button>
    </div>}
    {children}
  </StoreContext.Provider>;
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) throw new Error('useStore 必须在 StoreProvider 内使用');
  return context;
}
