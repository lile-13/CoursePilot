import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createEmptyState, STORAGE_KEY } from '../src/lib/storage.js';
const { openDatabase } = createRequire(import.meta.url)('../electron/database.cjs');

test('真实桌面 Store + SQLite：写入失败保留预览和旧状态，成功后才离开并可重启读取', async () => {
  const project = fileURLToPath(new URL('..', import.meta.url));
  await mkdir(join(project, 'node_modules/.cache'), { recursive: true });
  const bundleDir = await mkdtemp(join(project, 'node_modules/.cache/desktop-storage-test-'));
  const profile = await mkdtemp(join(tmpdir(), 'coursepilot-desktop-storage-'));
  const db = openDatabase(profile);
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:17890/#import' });
  const previous = new Map(); let root, store, failSave = true, done = 0;
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const old = createEmptyState(); old.settings.semesterName = '迁移前学期';
  const raw = JSON.stringify(old); localStorage.setItem(STORAGE_KEY, raw);
  window.coursepilotDesktop = { isDesktop: true, database: {
    initialize: async v => ({ ok: true, ...db.initialize(v) }),
    save: async v => failSave ? { ok: false, error: '模拟磁盘已满' }
      : { ok: true, ...db.save(v.state, v.revision) },
  } };
  try {
    const output = await build({ stdin: {
      contents: "export {StoreProvider,useStore} from './src/store.jsx';export {default as ImportPage} from './src/components/ImportPage.jsx';",
      resolveDir: project, loader: 'jsx',
    }, bundle: true, platform: 'node', format: 'esm', packages: 'external', loader: { '.html': 'text' }, write: false });
    const entry = join(bundleDir, 'entry.mjs'); await writeFile(entry, output.outputFiles[0].text);
    const { StoreProvider, useStore, ImportPage } = await import(pathToFileURL(entry).href);
    const { createRoot } = await import('react-dom/client');
    function Probe() { store = useStore(); return null; }
    const mount = async () => {
      root = createRoot(document.getElementById('root'));
      await act(async () => root.render(React.createElement(React.StrictMode, null,
        React.createElement(StoreProvider, null, React.createElement(Probe),
          React.createElement(ImportPage, { onDone: () => done++ })))));
    };
    await mount(); assert.equal(store.settings.semesterName, '迁移前学期');
    assert.equal(localStorage.getItem(STORAGE_KEY), raw, '迁移不删除原 localStorage');
    const before = db.read();
    await act(async () => window.dispatchEvent(new window.MessageEvent('message', {
      origin: 'https://jwxt.neu.edu.cn', data: { type: 'COURSEPILOT_SCHEDULE', capturedAt: 1,
        sessions: [{ name: '数据库导入测试', day: 2, start: 3, end: 4, weeksText: '10-13周' }] },
    })));
    const confirm = () => [...document.querySelectorAll('button')].find(b => b.textContent.trim() === '确认并保存');
    await act(async () => confirm().click());
    assert.equal(done, 0); assert.equal(store.courses.length, 0);
    assert.deepEqual(db.read(), before); assert.ok(document.querySelector('.preview-card'));
    assert.match(document.querySelector('[role="alert"]').textContent, /模拟磁盘已满/);
    assert.doesNotMatch(store.toast?.message || '', /已导入/);
    failSave = false; await act(async () => confirm().click());
    assert.equal(done, 1); assert.equal(store.courses[0].name, '数据库导入测试');
    assert.equal(document.querySelector('[role="alert"]'), null);
    await act(async () => root.unmount()); await mount();
    assert.equal(store.courses[0].name, '数据库导入测试', '重启不能被旧 localStorage 覆盖');
    assert.equal(localStorage.getItem(STORAGE_KEY), raw);
  } finally {
    if (root) await act(async () => root.unmount()); db.close(); dom.window.close();
    await rm(bundleDir, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true });
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  }
});
