import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const { createNotificationService } = createRequire(import.meta.url)('../electron/notifications.cjs');

function setup(show = () => {}, timeoutMs = 1000) {
  const instances = [];
  const clicked = [];
  class NativeNotification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; instances.push(this); }
    show() { show(this); }
    close() { this.emit('close'); }
  }
  const service = createNotificationService({
    Notification: NativeNotification, timeoutMs, onClick: id => clicked.push(id),
  });
  return { instances, clicked, service };
}

test('只有 Windows 发出 show 事件才返回成功，成功后仍能点击通知', async () => {
  const { service, instances, clicked } = setup();
  let completed = false;
  const result = service.notify({ title: '提醒测试', body: '课程及截止时间', assignmentId: 'a1' })
    .then(value => { completed = true; return value; });
  await Promise.resolve();
  assert.equal(completed, false, 'show() 调用本身不能当作已显示');
  instances[0].emit('show');
  assert.deepEqual(await result, { ok: true });
  instances[0].emit('click');
  assert.deepEqual(clicked, ['a1']);
  service.close();
});

test('上课提醒点击时把 target 和 classKey 原样传给主进程', async () => {
  const calls = [];
  const instances = [];
  class NativeNotification extends EventEmitter {
    static isSupported() { return true; }
    constructor(options) { super(); this.options = options; instances.push(this); }
    show() {}
    close() {}
  }
  const service = createNotificationService({
    Notification: NativeNotification,
    timeoutMs: 1000,
    onClick: (id, payload) => calls.push({ id, payload }),
  });
  const payload = {
    title: '上课提醒：高等数学',
    body: '教室：A101',
    target: 'today',
    classKey: 'c1:s1:2026-11-17:08:30',
  };
  const result = service.notify(payload);
  instances[0].emit('show');
  assert.deepEqual(await result, { ok: true });
  instances[0].emit('click');
  assert.deepEqual(calls, [{ id: undefined, payload }]);
  service.close();
});

test('Windows 异步发送失败返回失败，下一次可以重试', async () => {
  const { service, instances } = setup();
  const first = service.notify();
  instances[0].emit('failed', {}, '平台错误');
  assert.deepEqual(await first, { ok: false, error: '平台错误' });
  const retry = service.notify();
  instances[1].emit('show');
  assert.equal((await retry).ok, true);
  service.close();
});

test('同步抛错不报告成功', async () => {
  const { service } = setup(() => { throw new Error('发送异常'); });
  assert.deepEqual(await service.notify(), { ok: false, error: '发送异常' });
});

test('一直没有显示结果时超时返回失败并关闭通知', async () => {
  const { service } = setup(() => {}, 15);
  const result = await service.notify();
  assert.equal(result.ok, false);
  assert.match(result.error, /超时/);
});

test('显示前关闭和不支持通知都不会报告成功', async () => {
  const { service, instances } = setup();
  const result = service.notify();
  instances[0].close();
  assert.equal((await result).ok, false);
  const unsupported = createNotificationService({
    Notification: { isSupported: () => false }, onClick() {},
  });
  assert.equal((await unsupported.notify()).ok, false);
});
