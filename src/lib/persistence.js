import { createEmptyState, loadState, normalizeStateForImport, saveState, STORAGE_KEY } from './storage.js';

export function desktopMigrationPayload() {
  let legacyRaw = null;
  try {
    legacyRaw = localStorage.getItem(STORAGE_KEY);
    const parsed = legacyRaw == null ? createEmptyState() : JSON.parse(legacyRaw);
    if (!parsed || !parsed.settings || !Array.isArray(parsed.courses) || !Array.isArray(parsed.assignments) ||
        parsed.courses.some(c => !c?.name || !Array.isArray(c.sessions)) ||
        parsed.assignments.some(a => !a?.title)) throw new Error('旧数据结构不完整');
    return { legacyRaw, initialState: normalizeStateForImport(parsed) };
  } catch (error) {
    return { legacyRaw, legacyError: error.message };
  }
}

// Serialize read-modify-save operations. The UI only receives committed snapshots.
export function createPersistence({ desktop, onState, onError }) {
  let state = desktop ? null : loadState() || createEmptyState();
  let revision = 0;
  let queue = Promise.resolve();
  let initializing;
  let path = '';
  return {
    get state() { return state; },
    initialize() {
      if (!desktop) return Promise.resolve({ state, path });
      if (!initializing) {
        initializing = desktop.database.initialize(desktopMigrationPayload()).then(result => {
          if (!result?.ok) throw new Error(result?.error || '数据库读取失败');
          state = result.state; revision = result.revision; path = result.path;
          return { state, path };
        }).catch(error => { initializing = null; throw error; });
      }
      return initializing;
    },
    commit(update) {
      const apply = async () => {
        try {
          if (!state) throw new Error('数据尚未加载，请稍后重试');
          const next = typeof update === 'function' ? update(state) : update;
          if (desktop) {
            const result = await desktop.database.save({ state: next, revision });
            if (!result?.ok) throw new Error(result?.error || '数据库保存失败');
            state = result.state; revision = result.revision;
          } else {
            if (!saveState(next)) throw new Error('浏览器本地存储写入失败');
            state = next;
          }
          onState(state);
          return true;
        } catch (error) {
          onError(error.message || String(error));
          return false;
        }
      };
      queue = queue.then(apply, apply);
      return queue;
    },
  };
}
