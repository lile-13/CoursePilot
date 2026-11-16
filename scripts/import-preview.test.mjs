import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { STORAGE_KEY, createEmptyState } from '../src/lib/storage.js';

test('真实React组件：预览与取消不保存，确认才同步；未知周次必须先补充', async () => {
  const rootDir = fileURLToPath(new URL('..', import.meta.url));
  const cache = join(rootDir, 'node_modules', '.cache');
  await mkdir(cache, { recursive: true });
  const temp = await mkdtemp(join(cache, 'coursepilot-test-'));
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://127.0.0.1:5173/#import' });
  const previousGlobals = new Map();
  for (const [name, value] of Object.entries({
    window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement, localStorage: dom.window.localStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  let root;
  try {
    const output = await build({
      stdin: { contents: "export {StoreProvider,useStore} from './src/store.jsx'; export {default as ImportPage} from './src/components/ImportPage.jsx';", resolveDir: rootDir, loader: 'jsx' },
      bundle: true, platform: 'node', format: 'esm', packages: 'external',
      loader: { '.html': 'text' }, write: false,
    });
    const entry = join(temp, 'components.mjs');
    await writeFile(entry, output.outputFiles[0].text);
    const { StoreProvider, useStore, ImportPage } = await import(pathToFileURL(entry).href);
    const { createRoot } = await import('react-dom/client');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(createEmptyState()));
    let store;
    let completed = 0;
    function Probe() { store = useStore(); return null; }
    root = createRoot(document.getElementById('root'));
    await act(async () => root.render(React.createElement(StoreProvider, null,
      React.createElement(Probe), React.createElement(ImportPage, { onDone: () => { completed += 1; } }))));
    const before = localStorage.getItem(STORAGE_KEY);
    const payload = {
      type: 'COURSEPILOT_SCHEDULE', capturedAt: 1, parserName: '东北大学教务接口',
      sessions: [{ name: '虚构实验课', type: 'lab', day: 4, start: 5, end: 6, weeksText: '4-6周(双),11周' }],
      sectionTimes: Array.from({ length: 6 }, () => ({ start: '08:30', end: '09:15' })),
    };
    const receive = async (data) => act(async () => window.dispatchEvent(new window.MessageEvent('message', { origin: 'https://jwxt.neu.edu.cn', data })));
    const click = async (label) => {
      const button = [...document.querySelectorAll('button')].find((element) => element.textContent.trim() === label);
      assert.ok(button, `没有找到按钮：${label}`);
      await act(async () => button.click());
    };
    await receive(payload);
    assert.equal(localStorage.getItem(STORAGE_KEY), before, '预览不能修改设置或课程');
    await click('取消导入');
    assert.equal(localStorage.getItem(STORAGE_KEY), before, '取消不能保存');
    assert.equal(document.querySelector('.preview-card'), null);
    await receive({ ...payload, capturedAt: 2 });
    await click('确认并保存');
    assert.equal(completed, 1);
    assert.equal(store.courses.length, 1);
    assert.equal(store.settings.periodTimes[0].start, '08:30');
    assert.equal(store.settings.periodsPerDay, 6);
    const after = localStorage.getItem(STORAGE_KEY);
    await receive({ ...payload, capturedAt: 3, sessions: [{ ...payload.sessions[0], weeksText: '' }] });
    assert.equal(document.querySelector('input[aria-label="周次"]').value, '');
    await click('确认并保存');
    assert.equal(completed, 1, '未知周次不能默认保存为1-16周');
    assert.match(document.querySelector('.form-error').textContent, /周次/);
    assert.equal(localStorage.getItem(STORAGE_KEY), after);
    await act(async () => store.actions.addAssignment({
      title: '提醒时间修改测试', dueAt: '2026-11-20T12:00', reminderMinutes: 30,
    }));
    const assignment = store.assignments.at(-1);
    await act(async () => store.actions.updateAssignment(assignment.id, { dueAt: '2026-11-21T12:00' }));
    await act(async () => store.actions.markAssignmentReminded(assignment.id, 123, {
      dueAt: assignment.dueAt, reminderMinutes: assignment.reminderMinutes,
    }));
    assert.equal(store.assignments.at(-1).reminderNotifiedAt, null, '旧通知的异步结果不能标记新截止时间');
    await act(async () => store.actions.markAssignmentReminded(assignment.id, 456, {
      dueAt: '2026-11-21T12:00', reminderMinutes: 30,
    }));
    assert.equal(store.assignments.at(-1).reminderNotifiedAt, 456);
  } finally {
    if (root) await act(async () => root.unmount());
    dom.window.close();
    if (dirname(temp) !== cache) throw new Error('测试缓存目录超出预期范围');
    await rm(temp, { recursive: true, force: true });
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
