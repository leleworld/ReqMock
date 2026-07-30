// Collection Runner 冒烟测试：node runner-smoke-test.mjs
// 覆盖：CSV/JSON 数据解析、请求收集、批量执行（数据驱动 + 迭代 + 断言 + 变量传递 + 中止）、报告导出
import { parseRunnerData, parseCsv, collectRunnableRequests, runCollection, exportRunReport } from './src/utils/runnerUtil.js';
import { executeRequest } from './src/utils/requestPipeline.js';

if (!globalThis.crypto || !globalThis.crypto.randomUUID) {
  const { webcrypto } = await import('node:crypto');
  globalThis.crypto = webcrypto;
}

let failed = 0;
function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed += 1;
}

// ---- 1. CSV 解析 ----
const csv = 'name,age\n"张,三",20\n"李""四",30\n\n王五,';
const rows = parseCsv(csv);
check('CSV 行数（忽略空行）', rows.length === 3);
check('CSV 引号含逗号', rows[0].name === '张,三' && rows[0].age === '20');
check('CSV 双引号转义', rows[1].name === '李"四');
check('CSV 缺列补空', rows[2].age === '');

// ---- 2. JSON 数据解析 ----
const jrows = parseRunnerData('[{"id":1,"tag":{"a":1}},{"id":2}]');
check('JSON 数组解析', jrows.length === 2 && jrows[0].id === '1');
check('JSON 嵌套对象字符串化', jrows[0].tag === '{"a":1}');
check('空内容返回空数组', parseRunnerData('  ').length === 0);
let threw = false;
try { parseRunnerData('[{bad'); } catch (e) { threw = true; }
check('非法 JSON 抛错', threw);

// ---- 3. 请求收集（深度优先 + 路径） ----
const col = {
  id: 'c1', name: '集合A',
  requests: [{ id: 'r1', name: '根请求', method: 'GET', url: 'http://x/1' }],
  folders: [{
    id: 'f1', name: '文件夹B',
    requests: [{ id: 'r2', name: '子请求', method: 'POST', url: 'http://x/2' }],
    folders: []
  }]
};
const items = collectRunnableRequests(col);
check('收集数量', items.length === 2);
check('收集顺序（根请求在前）', items[0].request.id === 'r1' && items[1].request.id === 'r2');
check('路径记录', items[1].path.join('/') === '集合A/文件夹B');

// ---- 4. executeRequest 管线（mock send） ----
const sent = [];
const fakeSend = async (payload) => {
  sent.push(payload);
  return {
    ok: true, status: 200, statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ echo: payload.url }),
    timeMs: 5, sizeBytes: 20, setCookies: []
  };
};
const pipelineReq = {
  id: 'p1', name: '管线请求', method: 'GET', url: 'http://api/{{host}}/u',
  headers: [], params: [], bodyType: 'none', body: '',
  preScript: 'rm.env.set("token", "abc")',
  postScript: 'rm.test("状态 200", () => rm.assert(rm.response.status === 200))'
};
const pr = await executeRequest(pipelineReq, {
  collections: [], varMap: { host: 'v1' }, settings: {}, cookieJar: [], send: fakeSend
});
check('管线变量替换', pr.finalReq.url === 'http://api/v1/u');
check('管线前置脚本 envSet', pr.envSet.token === 'abc');
check('管线后置断言通过', pr.tests.length === 1 && pr.tests[0].passed);

// ---- 5. runCollection 数据驱动 + 变量跨请求传递 ----
const runReqs = [
  {
    id: 'a', name: '登录', method: 'POST', url: 'http://s/login/{{user}}',
    headers: [], params: [], bodyType: 'none', body: '',
    postScript: 'rm.env.set("sid", "S-" + rm.response.status)'
  },
  {
    id: 'b', name: '查询', method: 'GET', url: 'http://s/q?sid={{sid}}&u={{user}}',
    headers: [], params: [], bodyType: 'none', body: '',
    postScript: 'rm.test("有 sid", () => rm.assert(rm.request.url.includes("S-200")))'
  }
];
sent.length = 0;
const run1 = await runCollection({
  items: runReqs.map((r) => ({ request: r, path: ['T'] })),
  dataRows: [{ user: 'u1' }, { user: 'u2' }],
  ctx: { collections: [], varMap: {}, settings: {}, cookieJar: [], send: fakeSend }
});
check('数据驱动总执行数 = 2行×2请求', run1.entries.length === 4);
check('行变量注入第1行', sent[0].url === 'http://s/login/u1');
check('行变量注入第2行', sent[2].url === 'http://s/login/u2');
check('迭代内脚本变量传递', sent[1].url.includes('sid=S-200'));
check('断言全部通过', run1.summary.passed === 4 && run1.summary.failed === 0);
check('断言统计', run1.summary.testsTotal === 2 && run1.summary.testsPassed === 2);

// ---- 6. 失败统计 + 网络错误 ----
const errSend = async () => ({ ok: false, error: 'ECONNREFUSED', timeMs: 3 });
const run2 = await runCollection({
  items: [{ request: runReqs[0], path: ['T'] }],
  iterations: 2,
  ctx: { collections: [], varMap: {}, settings: {}, cookieJar: [], send: errSend }
});
check('迭代次数生效', run2.entries.length === 2);
check('网络错误记为失败', run2.summary.failed === 2 && run2.entries[0].status === 'ERR');

// ---- 7. 中止 ----
let count = 0;
const run3 = await runCollection({
  items: runReqs.map((r) => ({ request: r, path: ['T'] })),
  iterations: 5,
  ctx: { collections: [], varMap: {}, settings: {}, cookieJar: [], send: fakeSend },
  shouldStop: () => count >= 3,
  onProgress: () => { count += 1; }
});
check('中止生效', run3.summary.stopped === true && run3.entries.length === 3);

// ---- 8. 报告导出 ----
const report = exportRunReport({ name: 'T', time: 'now' }, run1.entries, run1.summary);
check('报告含标题', report.includes('# 运行报告：T'));
check('报告含表格行', report.split('\n').filter((l) => l.startsWith('|')).length >= 6);

console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 项失败 ❌`);
process.exit(failed ? 1 : 0);
