/**
 * urlSync 冒烟测试：URL ↔ Params 双向同步 / form body 解析
 * 运行：node urlsync-smoke-test.mjs
 */
import {
  splitUrl, parseQuery, syncParamsFromUrl, buildUrlFromParams,
  parseFormBody, buildFormBody, normalizeOpenedRequest
} from './src/utils/urlSync.js';

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  [PASS] ' + name); }
  else { failed++; console.log('  [FAIL] ' + name); }
}

// ---- URL → Params ----
let p = syncParamsFromUrl('http://a.com/api?x=1&y=hello%20world', []);
check('URL 解析出 2 个参数', p.length === 2);
check('参数值正确解码', p[0].key === 'x' && p[0].value === '1' && p[1].value === 'hello world');

p = syncParamsFromUrl('http://a.com/api?x=1', [{ key: 'old', value: 'v', enabled: false }]);
check('保留禁用行', p.length === 2 && p[1].key === 'old' && p[1].enabled === false);

p = syncParamsFromUrl('http://a.com/api', [{ key: 'x', value: '1', enabled: true }]);
check('清空 query 则启用行清空', p.length === 0);

p = syncParamsFromUrl('http://a.com/api?token={{token}}', []);
check('{{var}} 占位符保留', p[0].value === '{{token}}');

// ---- Params → URL ----
let u = buildUrlFromParams('http://a.com/api?x=1', [
  { key: 'x', value: '2', enabled: true },
  { key: 'y', value: 'b c', enabled: true },
  { key: 'z', value: 'ignored', enabled: false }
]);
check('回写 URL（禁用行不写入）', u === 'http://a.com/api?x=2&y=b%20c');

u = buildUrlFromParams('http://a.com/api?x=1', []);
check('参数全删则 query 移除', u === 'http://a.com/api');

u = buildUrlFromParams('http://a.com/api', [{ key: 't', value: '{{token}}', enabled: true }]);
check('{{var}} 回写不被转义', u === 'http://a.com/api?t={{token}}');

// ---- 双向往返 ----
const url0 = 'http://a.com/api?a=1&b=2';
const rows = syncParamsFromUrl(url0, []);
check('往返一致', buildUrlFromParams(url0, rows) === url0);

// ---- form body ----
const fr = parseFormBody('name=tom&age=18');
check('form body 解析', fr.length === 2 && fr[1].key === 'age' && fr[1].value === '18');
check('form body 序列化', buildFormBody(fr) === 'name=tom&age=18');
check('form 禁用行不序列化', buildFormBody([{ key: 'a', value: '1', enabled: false }]) === '');

// ---- 打开请求自动加载 ----
let r = normalizeOpenedRequest({ url: 'http://a.com/x?k=v', params: [], headers: [] });
check('打开请求：URL 带 query 自动填充 Params', r.params.length === 1 && r.params[0].key === 'k');

r = normalizeOpenedRequest({ url: 'http://a.com/x?k=v', params: [{ key: 'k', value: 'v', enabled: true }], headers: [] });
check('打开请求：Params 已有值则不重复解析', r.params.length === 1);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
