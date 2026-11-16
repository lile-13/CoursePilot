const DESKTOP_ORIGIN = 'http://127.0.0.1:17890';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return false;

  if (message.type === 'CPX_HEALTH') {
    fetch(`${DESKTOP_ORIGIN}/api/health`, { cache: 'no-store' })
      .then((response) => sendResponse({ ok: response.ok }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'CPX_POST_IMPORT') {
    fetch(`${DESKTOP_ORIGIN}/api/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: message.body,
    })
      .then((response) =>
        response
          .json()
          .then((data) => sendResponse({ ok: response.ok && Boolean(data && data.ok), count: data?.count }))
          .catch(() => sendResponse({ ok: false }))
      )
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  return false;
});
