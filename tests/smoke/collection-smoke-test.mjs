/**
 * 集合功能冒烟测试（无 GUI）：
 *   node collection-smoke-test.mjs
 * 覆盖：集合树操作 / 导入导出（原生 + Hoppscotch + Postman）/ 环境变量替换 / 脚本执行器
 */
import {
  newCollection, newFolder, normalizeNode,
  updateNode, removeNode, findNode,
  upsertRequestById, removeRequestById, findOwnerCollection, countRequests,
  exportCollection, exportWorkspace, parseImport
} from './src/utils/collectionUtil.js';
import { buildVarMap, resolveVars, resolveRequest } from './src/utils/envUtil.js';
import { runScript } from './src/utils/scriptRunner.js';

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  [PASS] ' + name); }
  else { failed++; console.log('  [FAIL] ' + name); }
}

// ---- 1. 集合树操作 ----
let col = newCollection('测试集合');
const folder = newFolder('用户模块');
col = { ...col, folders: [folder] };
let tree = [col];

const req = { id: 'r1', name: '查询用户', method: 'GET', url: 'http://a/b', params: [], headers: [], bodyType: 'none', body: '' };
tree = updateNode(tree, folder.id, (n) => ({ ...n, requests: [...n.requests, req] }));
check('文件夹内添加请求', findNode(tree, folder.id).requests.length === 1);
check('countRequests 递归统计', countRequests(tree[0]) === 1);
check('findOwnerCollection 定位所属集合', findOwnerCollection(tree, 'r1').id === col.id);

const { tree: tree2, found } = upsertRequestById(tree, { ...req, name: '改名后' });
check('upsertRequestById 原位更新', found && findNode(tree2, folder.id).requests[0].name === '改名后');

const sub = newFolder('子文件夹');
tree = updateNode(tree2, folder.id, (n) => ({ ...n, folders: [sub] }));
check('嵌套子文件夹', findNode(tree, sub.id) !== null);
tree = removeNode(tree, sub.id);
check('removeNode 删除嵌套文件夹', findNode(tree, sub.id) === null);

const treeNoReq = removeRequestById(tree, 'r1');
check('removeRequestById 删除请求', countRequests(treeNoReq[0]) === 0);

// ---- 2. 导入导出：原生格式往返 ----
const exported = exportCollection(tree[0]);
const imported = parseImport(exported);
check('原生集合导出→导入往返', imported.collections.length === 1 && countRequests(imported.collections[0]) === 1);
check('导入后重新生成 id', imported.collections[0].id !== tree[0].id);

const ws = exportWorkspace(tree, [{ id: 'e1', name: '开发', variables: [{ key: 'host', value: 'x', enabled: true }] }]);
const wsImported = parseImport(ws);
check('workspace 导出→导入（含环境）', wsImported.collections.length === 1 && wsImported.environments.length === 1);

// ---- 3. Hoppscotch 格式导入 ----
const hopp = JSON.stringify({
  v: 6, name: 'Hopp集合',
  folders: [{ v: 6, name: '子目录', folders: [], requests: [] }],
  requests: [{
    v: '11', name: '登录', method: 'POST', endpoint: 'https://api.test/login',
    params: [{ key: 'a', value: '1', active: true }],
    headers: [{ key: 'X-K', value: 'v', active: false }],
    body: { contentType: 'application/json', body: '{"u":"a"}' },
    preRequestScript: '// pre', testScript: '// test'
  }]
});
const hoppImported = parseImport(hopp);
const hoppReq = hoppImported.collections[0].requests[0];
check('Hoppscotch 集合识别', hoppImported.collections[0].name === 'Hopp集合');
check('Hoppscotch 请求转换', hoppReq.method === 'POST' && hoppReq.url === 'https://api.test/login' && hoppReq.bodyType === 'json');
check('Hoppscotch header active→enabled', hoppReq.headers[0].enabled === false);
check('Hoppscotch 脚本迁移', hoppReq.preScript === '// pre' && hoppReq.postScript === '// test');

let badOk = false;
try { parseImport('{"foo":1}'); } catch (e) { badOk = true; }
check('无法识别格式抛错', badOk);

// ---- 3.5 Postman v2.x 格式导入 ----
const pmCol = JSON.stringify({
  info: { name: 'PM集合', description: '描述', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  item: [
    {
      name: '用户目录',
      item: [{
        name: '查询用户',
        request: {
          method: 'get',
          url: { raw: 'https://api.test/users?page=1', query: [{ key: 'page', value: '1' }, { key: 'off', value: 'x', disabled: true }] },
          header: [{ key: 'X-K', value: 'v', disabled: true }]
        }
      }]
    },
    {
      name: '创建用户',
      request: {
        method: 'POST',
        url: 'https://api.test/users',
        header: [],
        body: { mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } },
        auth: { type: 'bearer', bearer: [{ key: 'token', value: 'tk123' }] }
      },
      event: [
        { listen: 'prerequest', script: { exec: ['// pm pre'] } },
        { listen: 'test', script: { exec: ['// pm test'] } }
      ]
    }
  ]
});
const pmImported = parseImport(pmCol);
const pmRoot = pmImported.collections[0];
const pmFolderReq = pmRoot.folders[0].requests[0];
const pmRootReq = pmRoot.requests[0];
check('Postman 集合识别', pmRoot.name === 'PM集合' && pmRoot.doc === '描述');
check('Postman 嵌套目录转换', pmRoot.folders[0].name === '用户目录' && pmFolderReq.name === '查询用户');
check('Postman 请求转换',
  pmFolderReq.method === 'GET' &&
  pmFolderReq.url === 'https://api.test/users?page=1' &&
  pmFolderReq.params.length === 2 && pmFolderReq.params[1].enabled === false &&
  pmFolderReq.headers[0].enabled === false);
check('Postman raw json body', pmRootReq.bodyType === 'json' && pmRootReq.body === '{"a":1}');
check('Postman auth 转换', pmRootReq.auth.type === 'bearer' && pmRootReq.auth.token === 'tk123');
check('Postman 脚本迁移', pmRootReq.preScript === '// pm pre' && pmRootReq.postScript === '// pm test');

const pmEnv = JSON.stringify({
  name: 'PM环境',
  values: [
    { key: 'host', value: 'http://x', enabled: true },
    { key: 'off', value: 'y', enabled: false }
  ],
  _postman_variable_scope: 'environment'
});
const pmEnvImported = parseImport(pmEnv);
check('Postman 环境识别',
  pmEnvImported.environments.length === 1 &&
  pmEnvImported.environments[0].name === 'PM环境' &&
  pmEnvImported.environments[0].variables[0].value === 'http://x' &&
  pmEnvImported.environments[0].variables[1].enabled === false);

// ---- 4. 环境变量替换 ----
const varMap = buildVarMap({ variables: [
  { key: 'host', value: 'http://localhost:3600', enabled: true },
  { key: 'token', value: 'abc', enabled: true },
  { key: 'off', value: 'x', enabled: false }
]});
check('禁用变量不进入 varMap', !('off' in varMap));
check('resolveVars 替换', resolveVars('{{host}}/api?t={{token}}', varMap) === 'http://localhost:3600/api?t=abc');
check('未定义变量保留原样', resolveVars('{{unknown}}', varMap) === '{{unknown}}');

const resolved = resolveRequest({
  url: '{{host}}/u', params: [{ key: 'k', value: '{{token}}', enabled: true }],
  headers: [{ key: 'Authorization', value: 'Bearer {{token}}', enabled: true }],
  bodyType: 'json', body: '{"t":"{{token}}"}'
}, varMap);
check('resolveRequest 全字段替换',
  resolved.url === 'http://localhost:3600/u' &&
  resolved.params[0].value === 'abc' &&
  resolved.headers[0].value === 'Bearer abc' &&
  resolved.body === '{"t":"abc"}');

// ---- 5. 脚本执行器 ----
const preReq = { method: 'GET', url: 'http://a', headers: [] };
const pre = await runScript(
  'rm.env.set("uid", "u100"); rm.request.headers.push({key:"X-T", value:rm.env.get("uid"), enabled:true}); console.log("pre done");',
  { request: preReq, response: null, varMap: {} }
);
check('前置脚本写环境变量', pre.ok && pre.envSet.uid === 'u100');
check('前置脚本修改请求', pre.request.headers.length === 1 && pre.request.headers[0].value === 'u100');
check('console 捕获', pre.logs.length === 1 && pre.logs[0].text === 'pre done');

const post = await runScript(
  'rm.test("状态码200", () => rm.assert(rm.response.status === 200));' +
  'rm.test("必然失败", () => rm.assert(false, "就是不对"));' +
  'rm.env.set("name", rm.response.json().name);',
  { request: {}, response: { status: 200, statusText: 'OK', headers: {}, body: '{"name":"tom"}', timeMs: 5 }, varMap: {} }
);
check('后置脚本测试通过项', post.tests[0].passed === true);
check('后置脚本测试失败项带信息', post.tests[1].passed === false && post.tests[1].error === '就是不对');
check('response.json() 提取变量', post.envSet.name === 'tom');

const bad = await runScript('throw new Error("boom")', { request: {}, response: null, varMap: {} });
check('脚本异常被捕获', bad.ok === false && bad.error === 'boom');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
