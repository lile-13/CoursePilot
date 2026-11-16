// Keep native notification objects alive until Windows closes them or the app exits.
function createNotificationService({ Notification, onClick, timeoutMs = 10000 }) {
  const active = new Set();
  function notify(payload = {}) {
    if (!Notification.isSupported()) {
      return Promise.resolve({ ok: false, error: '当前系统不支持桌面通知' });
    }
    return new Promise((resolve) => {
      let notification;
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const fail = (error) => {
        active.delete(notification);
        finish({ ok: false, error: String(error || 'Windows 未能显示通知') });
      };
      const timer = setTimeout(() => {
        fail('等待 Windows 通知显示超时，将稍后重试');
        notification?.close();
      }, timeoutMs);
      try {
        notification = new Notification({
          title: String(payload.title || '作业截止提醒'),
          body: String(payload.body || ''),
          silent: false,
          timeoutType: 'default',
        });
        active.add(notification);
        notification.once('show', () => finish({ ok: true }));
        notification.once('failed', (_event, error) => fail(error));
        notification.once('close', () => {
          active.delete(notification);
          finish({ ok: false, error: '通知在显示前已关闭' });
        });
        notification.on('click', () => onClick(payload.assignmentId));
        notification.show();
      } catch (error) {
        fail(error.message || error);
      }
    });
  }
  return {
    notify,
    close() {
      for (const notification of [...active]) notification.close();
      active.clear();
    },
  };
}

module.exports = { createNotificationService };
