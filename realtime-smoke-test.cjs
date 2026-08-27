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

  // connecting 过渡事件：connect 调用后、open 之前应先到 connecting
  const stEvents = [];
  const manager3 = new WsManager((evt) => stEvents.push(evt));
  manager3.connect({ id: 'c3', url: `ws://localhost:${WS_PORT}/sock` });
  assert('connecting event emitted first', stEvents.length > 0 && stEvents[0].type === 'connecting', JSON.stringify(stEvents.slice(0, 2)));
  manager3.closeAll();

  await new Promise((resolve) => wss.close(resolve));
}

/** 子协议协商 + 二进制帧展示 */
async function testWsExtras() {
  console.log('WebSocket extras:');
  let serverProtocol = '';
  const wss = new WebSocketServer({
    port: WS_PORT + 1,
    handleProtocols: (protocols) => {
      serverProtocol = protocols.has('chat.v1') ? 'chat.v1' : false;
      return serverProtocol;
    }
  });
  wss.on('connection', (socket) => {
    socket.send(Buffer.from([1, 2, 3, 4, 5]), { binary: true });
  });

  const events = [];
  const manager = new WsManager((evt) => events.push(evt));
  manager.connect({ id: 'c4', url: `ws://localhost:${WS_PORT + 1}/`, protocols: ['chat.v1', 'chat.v2'] });
  assert('open event with protocols', await waitFor(() => events.some((e) => e.type === 'open')), JSON.stringify(events));
  assert('server negotiated subprotocol', serverProtocol === 'chat.v1', serverProtocol);
  assert('connecting event lists protocols', events.some((e) => e.type === 'connecting' && e.data.includes('chat.v1')), JSON.stringify(events[0]));

  // 二进制帧：不猜测内容，展示字节数并带 binary/size 字段
  assert('binary frame reported', await waitFor(() => events.some((e) =>
    e.type === 'message' && e.direction === 'in' && e.binary === true && e.size === 5 && e.data.includes('5 字节'))), JSON.stringify(events));
  manager.closeAll();
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

/** SSE 断线自动重连：携带 Last-Event-ID、reconnecting 通知、手动断开即停止 */
async function testSseReconnect() {
  console.log('SSE reconnect:');
  let requestCount = 0;
  let lastEventIdSeen = '';
  const server = http.createServer((req, res) => {
    requestCount += 1;
    lastEventIdSeen = req.headers['last-event-id'] || '';
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('retry: 500\n\n'); // 缩短退避基数，加速测试
    res.write('id: 7\nevent: tick\ndata: hello\n\n');
    setTimeout(() => res.end(), 50); // 推完即断，触发重连
  });
  await new Promise((resolve) => server.listen(SSE_PORT + 1, resolve));
  const url = `http://localhost:${SSE_PORT + 1}/events`;

  const events = [];
  const manager = new SseManager((evt) => events.push(evt));
  manager.connect({ id: 'r1', url, headers: [], autoReconnect: true });
  assert('connecting event emitted', events.some((e) => e.type === 'connecting'), JSON.stringify(events.slice(0, 2)));
  assert('reconnect requested after server end', await waitFor(() => requestCount >= 2, 6000), `requests=${requestCount}`);
  assert('reconnect carries Last-Event-ID', lastEventIdSeen === '7', lastEventIdSeen);
  assert('reconnecting notice emitted', events.some((e) => e.type === 'reconnecting'), JSON.stringify(events.map((e) => e.type)));
  assert('reconnect log carries Last-Event-ID text', events.some((e) => e.type === 'connecting' && e.data.includes('Last-Event-ID=7')), 'no');

  // 手动断开：产生 close 通知且不再重连
  manager.close('r1');
  const before = requestCount;
  await new Promise((r) => setTimeout(r, 1300));
  assert('manual close stops reconnect', requestCount === before, `${before} -> ${requestCount}`);
  assert('manual close emits close event', events.some((e) => e.type === 'close' && e.data === '已断开连接'));

  // 关闭自动重连：服务端断开后不产生 reconnecting，也不再请求
  const offEvents = [];
  const manager2 = new SseManager((evt) => offEvents.push(evt));
  const offBefore = requestCount;
  manager2.connect({ id: 'r2', url, headers: [], autoReconnect: false });
  assert('autoReconnect=false open ok', await waitFor(() => offEvents.some((e) => e.type === 'open')), JSON.stringify(offEvents.map((e) => e.type)));
  assert('autoReconnect=false close emitted', await waitFor(() => offEvents.some((e) => e.type === 'close')), JSON.stringify(offEvents.map((e) => e.type)));
  await new Promise((r) => setTimeout(r, 1300));
  assert('autoReconnect=false no reconnecting notice', !offEvents.some((e) => e.type === 'reconnecting'), JSON.stringify(offEvents.map((e) => e.type)));
  assert('autoReconnect=false no extra request', requestCount === offBefore + 1, `${offBefore} -> ${requestCount}`);
  manager.closeAll();
  manager2.closeAll();

  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  await testWs();
  await testWsExtras();
  await testSse();
  await testSseReconnect();
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('REALTIME SMOKE TEST CRASH:', e);
  process.exit(1);
});
