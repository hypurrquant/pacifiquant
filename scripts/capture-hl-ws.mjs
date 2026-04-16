// Connect to Chrome CDP, attach to a page target matching a URL substring,
// and capture WS frames via Network.webSocketFrameSent / webSocketFrameReceived
// plus REST /info POST bodies via Network.requestWillBeSent.
//
// Usage:
//   node scripts/capture-hl-ws.mjs <browser-ws-url> <duration-seconds> [target-url-substring]
// Examples:
//   node scripts/capture-hl-ws.mjs $(agent-browser get cdp-url) 20               # HL (default)
//   node scripts/capture-hl-ws.mjs $(agent-browser get cdp-url) 20 localhost     # our dev server

import WebSocket from 'ws';

const BROWSER_URL = process.argv[2];
const DURATION_MS = parseInt(process.argv[3] ?? '30', 10) * 1000;
const TARGET_FILTER = process.argv[4] ?? 'hyperliquid.xyz';

if (!BROWSER_URL) {
  console.error('usage: node capture-hl-ws.mjs <browser-ws> <seconds> [target-url-substring]');
  process.exit(1);
}

let msgId = 0;
const pending = new Map();

function send(ws, method, params = {}, sessionId = null) {
  const id = ++msgId;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify(payload));
  });
}

const frames = [];
const restInfo = [];
const startedAt = Date.now();

const ws = new WebSocket(BROWSER_URL, { perMessageDeflate: false });

ws.on('open', async () => {
  try {
    const { targetInfos } = await send(ws, 'Target.getTargets');
    const target = targetInfos.find(
      (t) => t.type === 'page' && t.url.includes(TARGET_FILTER),
    );
    if (!target) {
      console.error(`No page target matching "${TARGET_FILTER}". Current targets:`);
      for (const t of targetInfos) console.error(' -', t.type, t.url);
      process.exit(2);
    }
    console.error('Attaching to target:', target.url);

    const { sessionId } = await send(ws, 'Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });

    await send(ws, 'Network.enable', {}, sessionId);
    await send(ws, 'Page.enable', {}, sessionId);

    console.error('Reloading to capture fresh WS handshake + subscribe frames...');
    await send(ws, 'Page.reload', { ignoreCache: true }, sessionId);

    setTimeout(() => {
      console.error(
        `\nCaptured ${frames.length} WS frames and ${restInfo.length} REST /info calls in ${DURATION_MS / 1000}s`,
      );
      console.log(JSON.stringify({ frames, restInfo }, null, 2));
      process.exit(0);
    }, DURATION_MS);
  } catch (err) {
    console.error('Setup error:', err.message);
    process.exit(4);
  }
});

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString());

  if (msg.id !== undefined) {
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
      return;
    }
  }

  if (!msg.method || !msg.params) return;
  const t = Date.now() - startedAt;

  if (msg.method === 'Network.webSocketFrameSent') {
    frames.push({
      t,
      dir: 'send',
      requestId: msg.params.requestId,
      payload: msg.params.response?.payloadData ?? '',
    });
  } else if (msg.method === 'Network.webSocketFrameReceived') {
    frames.push({
      t,
      dir: 'recv',
      requestId: msg.params.requestId,
      payload: msg.params.response?.payloadData ?? '',
    });
  } else if (msg.method === 'Network.requestWillBeSent') {
    const req = msg.params.request;
    if (req?.url?.includes('/info') && req.method === 'POST') {
      restInfo.push({
        t,
        url: req.url,
        body: req.postData ?? '',
      });
    }
  }
});

ws.on('error', (err) => {
  console.error('WS error:', err.message);
  process.exit(3);
});
