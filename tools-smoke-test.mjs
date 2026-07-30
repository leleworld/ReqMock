/**
 * 新功能冒烟测试：Diff / 工具箱 / 代码生成 / 导出 / Cookie / 多格式导入 / 全局变量
 * 运行：node tools-smoke-test.mjs
 */
import { diffLines, diffStats } from './src/utils/diffUtil.js';
import {
  b64Encode, b64Decode, urlEncode, urlDecode,
  jsonEscape, jsonUnescape, unicodeEscape, unicodeUnescape,
  tsToDate, dateToTs, genUuids
} from './src/utils/toolboxUtil.js';
import { generateCode, buildFullUrl, CODEGEN_LANGS } from './src/utils/codegenUtil.js';
import { exportPostmanCollection, exportMarkdownDocs } from './src/utils/exportUtil.js';
import { parseSetCookie, upsertCookies, buildCookieHeader, pruneCookies } from './src/utils/cookieUtil.js';
import { parseImport, normalizeRequest } from './src/utils/collectionUtil.js';
import { buildVarMap } from './src/utils/envUtil.js';
import { normalizeSettings } from './src/utils/themeUtil.js';

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log(`  [PASS] ${name}`); }
  else { failed++; console.error(`  [FAIL] ${name}`); }
}

// ---- Diff ----
{
  const d = diffLines('a\nb\nc', 'a\nx\nc');
  check('diff 同行识别', d[0].type === 'same' && d[d.length - 1].type === 'same');
  check('diff 增删识别', d.some((l) => l.type === 'del' && l.text === 'b') && d.some((l) => l.type === 'add' && l.text === 'x'));
  const s = diffStats(d);
  check('diffStats 统计', s.added === 1 && s.removed === 1);
  check('diff 完全一致', diffLines('same', 'same').every((l) => l.type === 'same'));
  check('diff 空文本', diffStats(diffLines('', 'a')).added === 1);
}

// ---- 工具箱 ----
{
  check('base64 往返（中文）', b64Decode(b64Encode('你好 world')) === '你好 world');
  check('url 编解码往返', urlDecode(urlEncode('a=1&b=中')) === 'a=1&b=中');
  check('json 转义往返', jsonUnescape(jsonEscape('a"b\n中')) === 'a"b\n中');
  check('unicode 转义', unicodeEscape('中a') === '\\u4e2da');
  check('unicode 反转义', unicodeUnescape('\\u4e2da') === '中a');
  const t1 = tsToDate('1700000000');
  check('时间戳秒识别', t1.unit === '秒' && t1.date.startsWith('2023-11-'));
  const t2 = tsToDate('1700000000000');
  check('时间戳毫秒识别', t2.unit === '毫秒');
  const dt = dateToTs('2023-11-15 06:13:20');
  check('日期转时间戳', dt.millis === dt.seconds * 1000 && dt.seconds > 1_600_000_000);
  let tsErr = false;
  try { tsToDate('abc'); } catch (e) { tsErr = true; }
  check('非法时间戳抛错', tsErr);
  const uuids = genUuids(5);
  check('UUID 批量生成', uuids.length === 5 && new Set(uuids).size === 5);
  check('UUID 格式', /^[0-9a-f-]{36}$/.test(uuids[0]));
  check('UUID 数量上限', genUuids(999).length === 100);
}

// ---- 代码生成 ----
{
  const req = normalizeRequest({
    method: 'POST',
    url: 'https://api.example.com/users?old=1',
    params: [{ key: 'page', value: '2', enabled: true }, { key: 'skip', value: 'x', enabled: false }],
    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    bodyType: 'json',
    body: '{"name":"tom"}'
  });
  const full = buildFullUrl(req);
  check('buildFullUrl 合并启用参数', full.includes('page=2') && !full.includes('skip='));
  for (const lang of CODEGEN_LANGS) {
    const code = generateCode(lang.value, req);
    check(`codegen ${lang.value} 含 URL 与方法`, code.includes('api.example.com') && /post/i.test(code));
  }
  const fetchCode = generateCode('fetch', req);
  check('fetch 含 headers 与 body', fetchCode.includes('Content-Type') && fetchCode.includes('{\\"name\\":\\"tom\\"}'));
  const py = generateCode('python', req);
  check('python 含 requests.request', py.includes('requests.request("POST"'));
}

// ---- 导出（Postman / Markdown） ----
{
  const col = {
    id: 'c1', name: '用户服务', doc: '用户相关接口',
    headers: [{ key: 'X-App', value: 'demo', enabled: true }],
    folders: [{
      id: 'f1', name: '登录', folders: [],
      requests: [normalizeRequest({
        id: 'r2', name: '登录接口', method: 'POST', url: 'https://api.example.com/login',
        bodyType: 'json', body: '{"user":"tom"}',
        auth: { type: 'bearer', token: 'tk1' },
        preScript: 'console.log(1);'
      })]
    }],
    requests: [normalizeRequest({
      id: 'r1', name: '用户列表', method: 'GET', url: 'https://api.example.com/users',
      params: [{ key: 'page', value: '1', enabled: true }],
      doc: '分页获取用户'
    })]
  };
  const pm = JSON.parse(exportPostmanCollection(col));
  check('Postman 导出 schema', pm.info.schema.includes('v2.1.0'));
  check('Postman 文件夹结构', pm.item.some((i) => i.name === '登录' && i.item.length === 1));
  const loginItem = pm.item.find((i) => i.name === '登录').item[0];
  check('Postman body/auth/event', loginItem.request.body.mode === 'raw' &&
    loginItem.request.auth.type === 'bearer' && loginItem.event[0].listen === 'prerequest');
  const listItem = pm.item.find((i) => i.name === '用户列表');
  check('Postman url.query', listItem.request.url.query[0].key === 'page');
  // Postman 导出可被自身导入逻辑识别（往返）
  const back = parseImport(exportPostmanCollection(col));
  check('Postman 导出→导入往返', back.collections.length === 1 && back.collections[0].name === '用户服务');

  const md = exportMarkdownDocs(col);
  check('Markdown 标题', md.startsWith('# 用户服务'));
  check('Markdown 公共 Headers 表', md.includes('## 公共 Headers') && md.includes('| X-App | demo |'));
  check('Markdown 请求块', md.includes('GET https://api.example.com/users?page=1') && md.includes('**授权**：Bearer Token'));
}

// ---- Cookie ----
{
  const c = parseSetCookie('sid=abc123; Path=/; HttpOnly; Max-Age=3600', 'https://api.example.com/login');
  check('Set-Cookie 解析', c.name === 'sid' && c.value === 'abc123' && c.domain === 'api.example.com' && c.hostOnly);
  check('Max-Age 转过期时间', c.expires > Date.now());
  const c2 = parseSetCookie('t=1; Domain=example.com; Secure', 'https://api.example.com/');
  check('Domain 属性去点', c2.domain === 'example.com' && !c2.hostOnly && c2.secure);

  let jar = upsertCookies([], [
    { raw: 'sid=abc; Path=/', url: 'https://api.example.com/login' },
    { raw: 't=1; Domain=example.com', url: 'https://api.example.com/' }
  ]);
  check('upsert 入 jar', jar.length === 2);
  jar = upsertCookies(jar, [{ raw: 'sid=new; Path=/', url: 'https://api.example.com/x' }]);
  check('同名同域覆盖', jar.length === 2 && jar.find((x) => x.name === 'sid').value === 'new');

  const hdr = buildCookieHeader(jar, 'https://api.example.com/users').split('; ').sort().join('; ');
  check('buildCookieHeader 匹配域', hdr === 'sid=new; t=1');
  check('子域匹配非 hostOnly', buildCookieHeader(jar, 'https://www.example.com/') === 't=1');
  check('不匹配域为空', buildCookieHeader(jar, 'https://other.com/') === '');

  const secureJar = upsertCookies([], [{ raw: 's=1; Secure', url: 'https://api.example.com/' }]);
  check('Secure 仅 https', buildCookieHeader(secureJar, 'http://api.example.com/') === '');

  const expired = upsertCookies(jar, [{ raw: 'sid=x; Max-Age=0', url: 'https://api.example.com/' }]);
  check('Max-Age=0 删除 Cookie', !expired.some((x) => x.name === 'sid'));
  check('pruneCookies 保留会话 Cookie', pruneCookies(jar).length === jar.length);
}

// ---- 多格式导入（OpenAPI / Insomnia / HAR） ----
{
  const openapi = JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Pet API' },
    servers: [{ url: 'https://petstore.example.com/v1' }],
    paths: {
      '/pets/{petId}': {
        get: {
          summary: '查询宠物', tags: ['pets'],
          parameters: [{ name: 'verbose', in: 'query' }]
        }
      },
      '/pets': {
        post: {
          summary: '创建宠物',
          requestBody: {
            content: {
              'application/json': {
                schema: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } } }
              }
            }
          }
        }
      }
    }
  });
  const oa = parseImport(openapi);
  check('OpenAPI 识别', oa.collections.length === 1 && oa.collections[0].name === 'Pet API');
  const oaCol = oa.collections[0];
  const allReqs = [...oaCol.requests, ...oaCol.folders.flatMap((f) => f.requests)];
  check('OpenAPI 路径参数转变量', allReqs.some((r) => r.url.includes('{{petId}}')));
  check('OpenAPI body 示例生成', allReqs.some((r) => r.bodyType === 'json' && r.body.includes('"name"')));

  const insomnia = JSON.stringify({
    _type: 'export', __export_format: 4,
    resources: [
      { _id: 'wrk_1', _type: 'workspace', name: '我的空间' },
      { _id: 'fld_1', _type: 'request_group', parentId: 'wrk_1', name: '分组A' },
      {
        _id: 'req_1', _type: 'request', parentId: 'fld_1', name: '取数据',
        method: 'GET', url: 'https://api.io/data?a={{ _.host }}',
        headers: [{ name: 'X-K', value: 'v' }]
      },
      { _id: 'env_1', _type: 'environment', parentId: 'wrk_1', name: 'Base', data: { host: 'api.io' } }
    ]
  });
  const ins = parseImport(insomnia);
  check('Insomnia 识别', ins.collections.length === 1 && ins.collections[0].name === '我的空间');
  const insReq = ins.collections[0].folders[0].requests[0];
  check('Insomnia 变量语法转换', insReq.url.includes('{{host}}'));
  check('Insomnia headers 转换', insReq.headers[0].key === 'X-K');
  check('Insomnia 环境导入', ins.environments.length === 1 && ins.environments[0].variables.some((v) => v.key === 'host'));

  const har = JSON.stringify({
    log: {
      entries: [{
        request: {
          method: 'POST', url: 'https://api.io/submit?q=1',
          headers: [
            { name: ':authority', value: 'api.io' },
            { name: 'content-type', value: 'application/json' },
            { name: 'Host', value: 'api.io' }
          ],
          postData: { mimeType: 'application/json', text: '{"k":1}' }
        }
      }]
    }
  });
  const h = parseImport(har);
  check('HAR 识别', h.collections.length === 1);
  const harReq = [...h.collections[0].requests, ...h.collections[0].folders.flatMap((f) => f.requests)][0];
  check('HAR 请求转换', harReq.method === 'POST' && harReq.bodyType === 'json');
  check('HAR 伪头与 Host 过滤', !harReq.headers.some((x) => x.key.startsWith(':') || x.key.toLowerCase() === 'host'));
}

// ---- 全局变量 + 设置 ----
{
  const env = { variables: [{ key: 'host', value: 'env.io', enabled: true }] };
  const globals = [
    { key: 'host', value: 'global.io', enabled: true },
    { key: 'token', value: 'g-tk', enabled: true },
    { key: 'off', value: 'x', enabled: false }
  ];
  const map = buildVarMap(env, globals);
  check('环境覆盖全局同名', map.host === 'env.io');
  check('全局变量并入', map.token === 'g-tk');
  check('禁用全局变量不并入', !('off' in map));
  check('无环境时仅全局', buildVarMap(null, globals).host === 'global.io');

  const st = normalizeSettings({ theme: 'light', accent: 'bad', cookiesEnabled: false });
  check('settings 规范化', st.theme === 'light' && st.accent === 'blue' && st.cookiesEnabled === false);
  const st2 = normalizeSettings(null);
  check('settings 默认值', st2.theme === 'dark' && st2.cookiesEnabled === true);
  check('layout 默认上下分栏', st2.layout === 'vertical');
  check('layout 合法值保留', normalizeSettings({ layout: 'horizontal' }).layout === 'horizontal');
  check('layout 非法值回退', normalizeSettings({ layout: 'diagonal' }).layout === 'vertical');
  check('IDEA 预置主题保留', ['islands-dark', 'islands-light', 'islands-darcula', 'high-contrast', 'light-header', 'darcula'].every((t) => normalizeSettings({ theme: t }).theme === t));
  check('非法主题回退深色', normalizeSettings({ theme: 'neon' }).theme === 'dark');
  check('旧油亮主题回退深色', ['midnight', 'oled', 'violet'].every((t) => normalizeSettings({ theme: t }).theme === 'dark'));
}

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
