/** 失败错误结构冒烟测试：验证 errorCode / phase / trace 等字段 */
const { sendHttpRequest } = require('../electron/httpClient.cjs');

async function main() {
  let pass = 0, fail = 0;
  const check = (name, cond, extra) => {
    if (cond) { pass++; console.log('  ✓ ' + name); }
    else { fail++; console.log('  ✗ ' + name + (extra ? ' → ' + JSON.stringify(extra) : '')); }
  };

  // 1. 连接被拒绝（本地空闲端口）
  let r = await sendHttpRequest({ method: 'GET', url: 'http://127.0.0.1:59999/x', timeoutMs: 5000 });
  console.log('ECONNREFUSED:', JSON.stringify(r));
  check('ok=false', r.ok === false);
  check('errorCode=ECONNREFUSED', r.errorCode === 'ECONNREFUSED', r);
  check('address/port', r.address === '127.0.0.1' && r.port === 59999, r);
  check('timeMs 存在', typeof r.timeMs === 'number');

  // 2. 域名解析失败
  r = await sendHttpRequest({ method: 'GET', url: 'http://no-such-host.reqmock.invalid/', timeoutMs: 5000 });
  check('errorCode=ENOTFOUND/EAI_AGAIN', r.errorCode === 'ENOTFOUND' || r.errorCode === 'EAI_AGAIN', r);

  // 3. URL 非法
  r = await sendHttpRequest({ method: 'GET', url: '{{host}}/api' });
  check('errorCode=BAD_URL', r.errorCode === 'BAD_URL', r);

  // 4. 超时（本地起个不响应的服务）
  const net = require('net');
  const srv = net.createServer(() => { /* 收连接但不回包 */ });
  await new Promise((res) => srv.listen(59998, res));
  r = await sendHttpRequest({ method: 'GET', url: 'http://127.0.0.1:59998/', timeoutMs: 800 });
  srv.close();
  check('errorCode=REQ_TIMEOUT', r.errorCode === 'REQ_TIMEOUT', r);
  check('phase=ttfb（已连上，等待响应）', r.phase === 'ttfb', r);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main();
