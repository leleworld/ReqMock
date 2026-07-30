/**
 * WebSocket / SSE 管理器冒烟测试（无 GUI）：
 *   node realtime-smoke-test.cjs
 * 本地起 ws 回显服务与 SSE http 服务，验证 WsManager / SseManager 的
 * 连接、自定义 Header、收发、事件解析与关闭。
 */
const http = require('http');
const { WebSocketServer } = require('ws');
const { WsManager } = require('./electron/wsClient.cjs');
const { SseManager } = require('./electron/sseClient.cjs');

const WS_PORT = 3612;
const SSE_PORT = 3613;
let passed = 0;
let failed = 0;

function assert(name, cond, detail) {
  if (cond) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failed++;
    console.log(`  [FAIL] ${name}${detail ? ' -> ' + detail : ''}`);
  }
}

/** 轮询等待条件成立（默认 3s 超时） */
function waitFor(cond, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (cond()) { clearInterval(timer); resolve(true); }
      else if (Date.now() - start > timeoutMs) { clearInterval(timer); resolve(false); }
    }, 20);
  });
}

async function testWs() {
  console.log('WebSocket:');
  // 回显服务：记录握手 Header，收到消息原样加前缀回发
  let seenHeader = '';
  const wss = new WebSocketServer({ port: WS_PORT });
  wss.on('connection', (socket, req) => {
    seenHeader = req.headers['x-test'] || '';
    socket.on('message', (data) => socket.send('echo:' + data.toString()));
  });

  const events = [];
  const manager = new WsManager((evt) => events.push(evt));

  // 未连接发送应报错
  const sendBefore = manager.send('c1', 'x');
  assert('send before connect rejected', !sendBefore.ok, JSON.stringify(sendBefore));

  // 连接（带自定义握手 Header）
  const conn = manager.connect({
    id: 'c1',
    url: `ws://localhost:${WS_PORT}/sock`,
    headers: [
      { key: 'X-Test', value: 'hs-1', enabled: true },
      { key: 'X-Off', value: 'no', enabled: false }
    ]
  });
  assert('connect returns ok', conn.ok, JSON.stringify(conn));
  assert('open event received', await waitFor(() => events.some((e) => e.type === 'open')), JSON.stringify(events));
  assert('custom handshake header sent', seenHeader === 'hs-1', seenHeader);

  // 收发：out 事件 + 服务端回显 in 事件
  const send = manager.send('c1', 'hello');
  assert('send ok', send.ok, JSON.stringify(send));
  assert('out message recorded',
    await waitFor(() => events.some((e) => e.type === 'message' && e.direction === 'out' && e.data === 'hello')),
    JSON.stringify(events));
  assert('echo message received',
    await waitFor(() => events.some((e) => e.type === 'message' && e.direction === 'in' && e.data === 'echo:hello')),
    JSON.stringify(events));

  // 关闭：close 事件 + 再次 send 报错
  manager.close('c1');
  assert('close event received', await waitFor(() => events.some((e) => e.type === 'close')), JSON.stringify(events));
  assert('send after close rejected', !manager.send('c1', 'x').ok);

  // 连接失败：无服务端口 → error 事件
  const errEvents = [];
  const manager2 = new WsManager((evt) => errEvents.push(evt));
  manager2.connect({ id: 'c2', url: 'ws://localhost:1/none' });
  assert('connect refused emits error', await waitFor(() => errEvents.some((e) => e.type === 'error')), JSON.stringify(errEvents));
  manager2.closeAll();

  await new Promise((resolve) => wss.close(resolve));
}

async function testSse() {
  console.log('SSE:');
  // SSE 服务：推 retry、注释心跳、命名事件（含 id 与多行 data），随后关闭
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/bad')) {
      res.writeHead(500);
      res.end('nope');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('retry: 3000\n\n');
    res.write(': heartbeat\n\n');
    res.write('id: 42\nevent: ticker\ndata: line1\ndata: line2\n\n');
    res.write(`data: {"auth":"${req.headers['x-auth'] || ''}"}\n\n`);
    setTimeout(() => res.end(), 100);
  });
  await new Promise((resolve) => server.listen(SSE_PORT, resolve));

  const events = [];
  const manager = new SseManager((evt) => events.push(evt));
  const conn = manager.connect({
    id: 's1',
    url: `http://localhost:${SSE_PORT}/events`,
    headers: [{ key: 'X-Auth', value: 'tok', enabled: true }]
  });
  assert('connect returns ok', conn.ok, JSON.stringify(conn));
  assert('open event received', await waitFor(() => events.some((e) => e.type === 'open')), JSON.stringify(events));
  assert('retry event parsed', await waitFor(() => events.some((e) => e.type === 'retry' && e.data === '3000')), JSON.stringify(events));

  // 命名事件：event / id / 多行 data 合并
  const gotNamed = await waitFor(() => events.some((e) =>
    e.type === 'message' && e.event === 'ticker' && e.lastEventId === '42' && e.data === 'line1\nline2'));
  assert('named event with id + multiline data', gotNamed, JSON.stringify(events));

  // 自定义 Header 生效（服务端回读）+ 服务端关闭 → close 事件
  assert('custom header sent',
    await waitFor(() => events.some((e) => e.type === 'message' && e.data.includes('"auth":"tok"'))),
    JSON.stringify(events));
  assert('server end emits close', await waitFor(() => events.some((e) => e.type === 'close')), JSON.stringify(events));

  // 注释行（心跳）不产生消息事件
  assert('comment line ignored', !events.some((e) => e.type === 'message' && e.data.includes('heartbeat')));

  // 非 200 响应 → error 事件
  const badEvents = [];
  const manager2 = new SseManager((evt) => badEvents.push(evt));
  manager2.connect({ id: 's2', url: `http://localhost:${SSE_PORT}/bad` });
  assert('non-200 emits error', await waitFor(() => badEvents.some((e) => e.type === 'error' && e.data.includes('500'))), JSON.stringify(badEvents));
  manager2.closeAll();
  manager.closeAll();

  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  await testWs();
  await testSse();
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('REALTIME SMOKE TEST CRASH:', e);
  process.exit(1);
});
