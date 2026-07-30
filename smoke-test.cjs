/**
 * 无 GUI 冒烟测试：MockServer + httpClient 联动自检
 * 运行：node smoke-test.cjs
 */
const { MockServer } = require('./electron/mockServer.cjs');
const { sendHttpRequest } = require('./electron/httpClient.cjs');

const PORT = 3611;
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

async function main() {
  const logs = [];
  const server = new MockServer((entry) => logs.push(entry));

  await server.start({
    port: PORT,
    routes: [
      {
        id: 'r1', name: 'user detail', method: 'GET', path: '/api/user/:id',
        status: 200, headers: [], delayMs: 0, enabled: true,
        body: '{"id":"{{params.id}}","kw":"{{query.kw}}","ts":"{{now}}"}'
      },
      {
        id: 'r2', name: 'echo body', method: 'POST', path: '/api/echo',
        status: 201, headers: [{ key: 'X-Mock', value: 'yes', enabled: true }],
        delayMs: 0, enabled: true,
        body: '{"name":"{{body.name}}","uid":"{{uuid}}"}'
      },
      {
        id: 'r3', name: 'disabled', method: 'GET', path: '/api/disabled',
        status: 200, headers: [], delayMs: 0, enabled: false, body: 'never'
      },
      {
        id: 'r4', name: 'rule route', method: 'GET', path: '/api/rule',
        status: 200, headers: [], delayMs: 0, enabled: true,
        body: '{"level":"normal"}',
        rules: [
          {
            id: 'rule1', name: 'vip 用户', enabled: true,
            when: { source: 'query', key: 'type', op: 'eq', value: 'vip' },
            status: 202, body: '{"level":"vip","who":"{{query.type}}"}'
          },
          {
            id: 'rule2', name: '禁用规则', enabled: false,
            when: { source: 'query', key: 'type', op: 'exists' },
            status: 500, body: 'never'
          }
        ]
      },
      {
        id: 'r5', name: 'random vars', method: 'GET', path: '/api/random',
        status: 200, headers: [], delayMs: 0, enabled: true,
        body: '{"n":"{{random.int}}","mail":"{{random.email}}","ip":"{{random.ip}}","bad":"{{random.nope}}"}'
      },
      {
        id: 'r6', name: 'script ok', method: 'POST', path: '/api/script',
        status: 200, headers: [], delayMs: 0, enabled: true, body: '',
        responseMode: 'script',
        script: 'response.status = 201;\nresponse.headers["X-Script"] = "1";\nresponse.body = { hello: request.body.name, method: request.method };'
      },
      {
        id: 'r7', name: 'script throw', method: 'GET', path: '/api/script-err',
        status: 200, headers: [], delayMs: 0, enabled: true, body: '',
        responseMode: 'script', script: 'throw new Error("boom");'
      },
      {
        id: 'r8', name: 'script timeout', method: 'GET', path: '/api/script-loop',
        status: 200, headers: [], delayMs: 0, enabled: true, body: '',
        responseMode: 'script', script: 'while (true) {}'
      }
    ]
  });
  console.log(`Mock server started on ${PORT}`);

  // 1. 路径参数 + query 模板
  const r1 = await sendHttpRequest({
    method: 'GET', url: `http://localhost:${PORT}/api/user/42`,
    params: [{ key: 'kw', value: 'hello', enabled: true }]
  });
  assert('GET :id route matched', r1.ok && r1.status === 200, JSON.stringify(r1));
  const b1 = r1.ok ? JSON.parse(r1.body) : {};
  assert('params.id rendered', b1.id === '42', r1.body);
  assert('query.kw rendered', b1.kw === 'hello', r1.body);
  assert('now rendered', /^\d{4}-/.test(b1.ts || ''), r1.body);

  // 2. POST body 模板 + 自定义 header + 状态码
  const r2 = await sendHttpRequest({
    method: 'POST', url: `http://localhost:${PORT}/api/echo`,
    bodyType: 'json', body: '{"name":"reqmock"}'
  });
  assert('POST status 201', r2.ok && r2.status === 201, JSON.stringify(r2));
  const b2 = r2.ok ? JSON.parse(r2.body) : {};
  assert('body.name rendered', b2.name === 'reqmock', r2.body);
  assert('uuid rendered', /^[0-9a-f-]{36}$/.test(b2.uid || ''), r2.body);
  assert('custom header returned', r2.headers && r2.headers['x-mock'] === 'yes', JSON.stringify(r2.headers));

  // 3. 未匹配 → 404；禁用路由不生效
  const r3 = await sendHttpRequest({ method: 'GET', url: `http://localhost:${PORT}/api/nothing` });
  assert('unmatched returns 404', r3.ok && r3.status === 404, JSON.stringify(r3));
  const r4 = await sendHttpRequest({ method: 'GET', url: `http://localhost:${PORT}/api/disabled` });
  assert('disabled route returns 404', r4.ok && r4.status === 404, JSON.stringify(r4));

  // 4. 条件规则：命中时覆盖 status/body，未命中回落默认响应；禁用规则不参与
  const rHit = await sendHttpRequest({
    method: 'GET', url: `http://localhost:${PORT}/api/rule`,
    params: [{ key: 'type', value: 'vip', enabled: true }]
  });
  assert('rule hit overrides status', rHit.ok && rHit.status === 202, JSON.stringify(rHit));
  const bHit = rHit.ok ? JSON.parse(rHit.body) : {};
  assert('rule hit body + template', bHit.level === 'vip' && bHit.who === 'vip', rHit.body);
  const rMiss = await sendHttpRequest({ method: 'GET', url: `http://localhost:${PORT}/api/rule` });
  assert('rule miss falls back', rMiss.ok && rMiss.status === 200 && JSON.parse(rMiss.body).level === 'normal', JSON.stringify(rMiss));

  // 5. {{random.*}} 渲染；未知 random 键保留原样
  const rRnd = await sendHttpRequest({ method: 'GET', url: `http://localhost:${PORT}/api/random` });
  const bRnd = rRnd.ok ? JSON.parse(rRnd.body) : {};
  assert('random.int rendered', /^\d+$/.test(bRnd.n || ''), rRnd.body);
  assert('random.email rendered', /@example\.com$/.test(bRnd.mail || ''), rRnd.body);
  assert('random.ip rendered', /^(\d+\.){3}\d+$/.test(bRnd.ip || ''), rRnd.body);
  assert('unknown random key kept', bRnd.bad === '{{random.nope}}', rRnd.body);

  // 6. 脚本化响应：正常 / 抛错 500 / 死循环超时 500
  const rScript = await sendHttpRequest({
    method: 'POST', url: `http://localhost:${PORT}/api/script`,
    bodyType: 'json', body: '{"name":"vm"}'
  });
  assert('script status/header', rScript.ok && rScript.status === 201 && rScript.headers['x-script'] === '1', JSON.stringify(rScript));
  const bScript = rScript.ok ? JSON.parse(rScript.body) : {};
  assert('script reads request', bScript.hello === 'vm' && bScript.method === 'POST', rScript.body);
  const rErr = await sendHttpRequest({ method: 'GET', url: `http://localhost:${PORT}/api/script-err` });
  assert('script throw -> 500', rErr.ok && rErr.status === 500 && rErr.body.includes('boom'), JSON.stringify(rErr));
  const rLoop = await sendHttpRequest({ method: 'GET', url: `http://localhost:${PORT}/api/script-loop` });
  assert('script timeout -> 500', rLoop.ok && rLoop.status === 500, JSON.stringify(rLoop));

  // 7. 日志回调
  assert('log entries recorded', logs.length === 10, `logs=${logs.length}`);
  assert('log matched flags', logs.filter(l => l.matched).length === 8, JSON.stringify(logs.map(l => l.matched)));

  // 8. 端口占用报错
  const server2 = new MockServer(() => {});
  let portError = '';
  try {
    await server2.start({ port: PORT, routes: [] });
  } catch (e) {
    portError = e.message;
  }
  assert('EADDRINUSE friendly error', portError.includes('已被占用'), portError);

  await server.stop();
  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('SMOKE TEST CRASH:', e);
  process.exit(1);
});
