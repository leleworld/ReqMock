/**
 * 新功能冒烟测试（无 GUI）：
 *   node feature-smoke-test.mjs
 * 覆盖：cURL 解析/生成 / 请求授权应用 / JSON 语法高亮分词 / GraphQL 请求管线
 */
import { parseCurl, toCurl } from './src/utils/curlUtil.js';
import { newAuth, normalizeAuth, applyAuth } from './src/utils/authUtil.js';
import { tokenizeJson, HIGHLIGHT_MAX_LENGTH } from './src/utils/highlightUtil.js';
import { normalizeOpenedRequest } from './src/utils/urlSync.js';
import { serializeGraphqlBody, parseIntrospection, buildOperationSkeleton, buildVariablesSkeleton } from './src/utils/graphqlUtil.js';
import { normalizeRequest } from './src/utils/collectionUtil.js';
import { resolveRequest } from './src/utils/envUtil.js';
import { generateCode } from './src/utils/codegenUtil.js';

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  [PASS] ' + name); }
  else { failed++; console.log('  [FAIL] ' + name); }
}

// ---- 1. cURL 解析 ----
const c1 = parseCurl(`curl -X POST 'https://api.test/login?a=1' \\
  -H 'Content-Type: application/json' \\
  -H "X-Token: abc" \\
  -d '{"user":"tom"}'`);
check('parseCurl 基本解析', c1.method === 'POST' && c1.url === 'https://api.test/login?a=1');
check('parseCurl headers', c1.headers.length === 2 && c1.headers[1].value === 'abc');
check('parseCurl json body', c1.bodyType === 'json' && c1.body === '{"user":"tom"}');

const c2 = parseCurl('curl api.test/u -u tom:123 -b "sid=9" -A "UA/1.0"');
check('parseCurl 无协议补 http', c2.url === 'http://api.test/u');
check('parseCurl -u 转 basic auth', c2.auth.type === 'basic' && c2.auth.username === 'tom' && c2.auth.password === '123');
check('parseCurl -b/-A 转 header',
  c2.headers.some((h) => h.key === 'Cookie' && h.value === 'sid=9') &&
  c2.headers.some((h) => h.key === 'User-Agent'));
check('parseCurl 无 body 默认 GET', c2.method === 'GET');

const c3 = parseCurl('curl -d "a=1" -d "b=2" -H "Content-Type: application/x-www-form-urlencoded" http://x/f');
check('parseCurl 多 -d 合并 form', c3.method === 'POST' && c3.body === 'a=1&b=2' && c3.bodyType === 'form');

const c4 = parseCurl('curl -G -d "q=1" http://x/s');
check('parseCurl -G 数据转 query', c4.url === 'http://x/s?q=1' && c4.body === '' && c4.method === 'GET');

let curlBad = false;
try { parseCurl('curl -X POST'); } catch (e) { curlBad = true; }
check('parseCurl 缺 URL 抛错', curlBad);

// 导入后 URL query 应同步到 Params 表（App handleCurlImport 的处理链）
const c5 = normalizeOpenedRequest(parseCurl('curl "http://x/api/v1.0/search?appVersion=00.102.180&otaVersion=0001"'));
check('导入后 query 填充 Params 表',
  c5.params.length === 2 &&
  c5.params[0].key === 'appVersion' && c5.params[0].value === '00.102.180' &&
  c5.params[1].key === 'otaVersion' && c5.params[1].value === '0001');

// ---- 2. cURL 生成 ----
const exported = toCurl({
  method: 'POST', url: 'http://x/api',
  headers: [{ key: 'X-A', value: '1', enabled: true }, { key: 'X-Off', value: '0', enabled: false }],
  bodyType: 'json', body: '{"k":"v"}',
  auth: { type: 'bearer', token: 'tk' }
});
check('toCurl 含方法与 URL', exported.includes("curl -X POST 'http://x/api'"));
check('toCurl 过滤禁用 header', exported.includes('X-A: 1') && !exported.includes('X-Off'));
check('toCurl bearer 转 header', exported.includes('Authorization: Bearer tk'));
check('toCurl 自动补 Content-Type', exported.includes('Content-Type: application/json'));
check('toCurl 携带 body', exported.includes(`-d '{"k":"v"}'`));

const roundTrip = parseCurl(exported);
check('toCurl→parseCurl 往返', roundTrip.method === 'POST' && roundTrip.url === 'http://x/api' && roundTrip.body === '{"k":"v"}');

// ---- 3. 授权应用 ----
check('newAuth 默认无授权', newAuth().type === 'none');
check('normalizeAuth 补齐字段', normalizeAuth({ type: 'bearer' }).addTo === 'header');

const basicReq = applyAuth({
  headers: [], params: [],
  auth: { type: 'basic', username: 'tom', password: '123' }
});
check('basic 生成 Authorization',
  basicReq.headers[0].key === 'Authorization' &&
  basicReq.headers[0].value === 'Basic ' + Buffer.from('tom:123').toString('base64'));

const keepReq = applyAuth({
  headers: [{ key: 'authorization', value: 'Custom x', enabled: true }], params: [],
  auth: { type: 'bearer', token: 'tk' }
});
check('已有同名 header 不覆盖', keepReq.headers.length === 1 && keepReq.headers[0].value === 'Custom x');

const queryReq = applyAuth({
  headers: [], params: [],
  auth: { type: 'apikey', key: 'api_key', value: 'v1', addTo: 'query' }
});
check('apikey 加入 query', queryReq.params[0].key === 'api_key' && queryReq.params[0].value === 'v1');

const noneReq = { headers: [], params: [], auth: { type: 'none' } };
check('none 类型原样返回', applyAuth(noneReq) === noneReq);

// ---- 4. JSON 高亮分词 ----
const json = '{\n  "name": "tom",\n  "age": 18,\n  "vip": true,\n  "tag": null\n}';
const tokens = tokenizeJson(json);
check('分词覆盖全文', tokens.map((t) => t.text).join('') === json);
check('key 识别', tokens.some((t) => t.type === 'key' && t.text === '"name"'));
check('string 识别', tokens.some((t) => t.type === 'string' && t.text === '"tom"'));
check('number 识别', tokens.some((t) => t.type === 'number' && t.text === '18'));
check('boolean 识别', tokens.some((t) => t.type === 'boolean' && t.text === 'true'));
check('null 识别', tokens.some((t) => t.type === 'null' && t.text === 'null'));

const esc = tokenizeJson('{"a\\"b": "c\\\\d"}');
check('转义字符串不截断', esc.some((t) => t.type === 'key' && t.text === '"a\\"b"'));
check('高亮长度上限已导出', HIGHLIGHT_MAX_LENGTH > 0);

// ---- 5. GraphQL 请求管线 ----
const gqlNorm = normalizeRequest({ id: 'g1', method: 'POST', url: 'http://x/gql' });
check('normalizeRequest 补 graphql 默认值', gqlNorm.graphql && gqlNorm.graphql.query === '' && gqlNorm.graphql.variables === '');

check('serializeGraphqlBody 无变量', serializeGraphqlBody({ query: 'query { me }' }) === '{"query":"query { me }"}');
const gqlBody = JSON.parse(serializeGraphqlBody({ query: 'query U($id: ID!) { user(id: $id) { name } }', variables: '{"id":"7"}' }));
check('serializeGraphqlBody 带变量', gqlBody.variables && gqlBody.variables.id === '7');
let gqlBad = false;
try { serializeGraphqlBody({ query: 'q', variables: '{bad' }); } catch (e) { gqlBad = true; }
check('serializeGraphqlBody 非法变量抛错', gqlBad);

// 环境变量替换覆盖 graphql 字段
const gqlResolved = resolveRequest({
  method: 'POST', url: 'http://{{host}}/gql', headers: [], params: [],
  bodyType: 'graphql', body: '',
  graphql: { query: 'query { user(id: "{{uid}}") { name } }', variables: '{"token":"{{tk}}"}' }
}, { host: 'api.test', uid: '9', tk: 'abc' });
check('resolveRequest 替换 graphql.query', gqlResolved.graphql.query.includes('id: "9"'));
check('resolveRequest 替换 graphql.variables', gqlResolved.graphql.variables === '{"token":"abc"}');

// curl / codegen 对 graphql 请求按序列化后的 JSON body 生成
const gqlReq = {
  method: 'POST', url: 'http://x/gql', headers: [], params: [],
  bodyType: 'graphql', body: '', auth: { type: 'none' },
  graphql: { query: 'query { me }', variables: '' }
};
const gqlCurl = toCurl(gqlReq);
check('toCurl graphql 转 JSON body', gqlCurl.includes('{"query":"query { me }"}') && gqlCurl.includes('Content-Type: application/json'));
const gqlCode = generateCode('fetch', gqlReq);
check('generateCode graphql 转 JSON body', gqlCode.includes('query { me }'));

// introspection 解析 + 骨架生成
const introBody = JSON.stringify({
  data: {
    __schema: {
      queryType: {
        name: 'Query',
        fields: [{
          name: 'user', description: '',
          args: [{ name: 'id', type: { kind: 'NON_NULL', ofType: { kind: 'SCALAR', name: 'ID' } } }],
          type: { kind: 'OBJECT', name: 'User' }
        }]
      },
      mutationType: {
        name: 'Mutation',
        fields: [{
          name: 'ping', description: '', args: [],
          type: { kind: 'SCALAR', name: 'String' }
        }]
      }
    }
  }
});
const ops = parseIntrospection(introBody);
check('parseIntrospection 操作列表', ops.length === 2 && ops[0].kind === 'query' && ops[1].kind === 'mutation');
check('parseIntrospection 类型签名', ops[0].args[0].type === 'ID!' && ops[0].returnType === 'User');
const skel = buildOperationSkeleton(ops[0]);
check('buildOperationSkeleton 变量与选择集', skel.includes('query User($id: ID!)') && skel.includes('user(id: $id) {'));
const scalarSkel = buildOperationSkeleton(ops[1]);
check('标量返回无选择集', scalarSkel.includes('mutation Ping') && !scalarSkel.includes('# 选择返回字段'));
check('buildVariablesSkeleton 占位', buildVariablesSkeleton(ops[0]) === '{\n  "id": null\n}' && buildVariablesSkeleton(ops[1]) === '');

let introBad = false;
try { parseIntrospection('{"errors":[{"message":"denied"}]}'); } catch (e) { introBad = e.message.includes('denied'); }
check('parseIntrospection 错误透传', introBad);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
