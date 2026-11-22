import test from 'node:test';
import assert from 'node:assert/strict';
import { createPersistence } from '../src/lib/persistence.js';
import { createEmptyState, STORAGE_KEY } from '../src/lib/storage.js';

test('桌面写入串行化：快速连续修改不丢失，失败不改页面，之后仍可重试', async () => {
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null };
  const errors = [], views = []; let writes = 0, failNext = false;
  const initial = createEmptyState();
  const controller = createPersistence({
    desktop: { database: {
      initialize: async () => ({ ok: true, state: initial, revision: 1, path: 'test.db' }),
      save: async ({ state, revision }) => {
        await new Promise(r => setTimeout(r, 5));
        if (failNext) { failNext = false; return { ok: false, error: '磁盘已满' }; }
        assert.equal(revision, writes + 1); writes++;
        return { ok: true, state, revision: revision + 1 };
      },
    } }, onState: v => views.push(v), onError: e => errors.push(e),
  });
  try {
    await controller.initialize();
    const append = name => s => ({ ...s, assignments: [...s.assignments, { title: name }] });
    const one = controller.commit(append('一')); const two = controller.commit(append('二'));
    assert.equal(views.length, 0, '数据库确认前不能显示已保存的数据');
    assert.deepEqual(await Promise.all([one, two]), [true, true]);
    assert.deepEqual(controller.state.assignments.map(a => a.title), ['一', '二']);
    failNext = true;
    assert.equal(await controller.commit(append('失败')), false);
    assert.equal(controller.state.assignments.length, 2);
    assert.equal(views.length, 2); assert.deepEqual(errors, ['磁盘已满']);
    assert.equal(await controller.commit(append('重试')), true);
    assert.equal(controller.state.assignments.length, 3);
  } finally { if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original; }
});

test('非首个账号初始化时忽略 localStorage 旧数据', async () => {
  const original = globalThis.localStorage;
  let payload;
  globalThis.localStorage = {
    getItem: () => {
      throw new Error('不应读取本地旧数据');
    },
  };
  try {
    const controller = createPersistence({
      allowLegacyMigration: false,
      desktop: {
        database: {
          initialize: async (value) => {
            payload = value;
            return { ok: true, state: createEmptyState(), revision: 1, path: 'new-user.db' };
          },
        },
      },
      onState() {},
      onError() {},
    });
    await controller.initialize();
    assert.equal(payload.legacyRaw, null);
    assert.equal(payload.initialState.courses.length, 0);
    assert.deepEqual(payload.initialState.assignments, []);
  } finally {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  }
});

test('损坏的旧数据传递明确错误且不删除；已有数据库可忽略旧数据', async () => {
  const original = globalThis.localStorage; let payload;
  globalThis.localStorage = { getItem: key => { assert.equal(key, STORAGE_KEY); return '{bad'; } };
  try {
    const controller = createPersistence({ desktop: { database: { initialize: async v => {
      payload = v; return { ok: true, state: createEmptyState(), revision: 5, path: 'existing.db' };
    } } }, onState() {}, onError() {} });
    await controller.initialize();
    assert.ok(payload.legacyError); assert.equal(payload.legacyRaw, '{bad');
    assert.ok(controller.state);
  } finally { if (original === undefined) delete globalThis.localStorage; else globalThis.localStorage = original; }
});
