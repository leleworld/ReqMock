/** 环境导入导出 + 备份格式 冒烟测试（临时验证脚本） */
import { exportEnvironment, exportEnvironments, parseImport } from '../src/utils/collectionUtil.js';
import { mergeVariables } from '../src/utils/envUtil.js';

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  [PASS] ' + name); }
  else { failed++; console.log('  [FAIL] ' + name); }
}

// 单个环境导出→导入往返
const env = { id: 'e1', name: '测试环境', variables: [{ key: 'host', value: 'a.com', enabled: true }] };
const single = parseImport(exportEnvironment(env));
check('单环境往返：环境数', single.environments.length === 1);
check('单环境往返：变量保留', single.environments[0].variables[0].key === 'host');
check('单环境往返：id 重新生成', single.environments[0].id !== 'e1');

// 环境包（含全局变量）导出→导入往返
const globals = [{ key: 'token', value: 't1', enabled: true }, { key: '', value: 'x', enabled: true }];
const pack = parseImport(exportEnvironments([env], globals));
check('环境包往返：环境数', pack.environments.length === 1);
check('环境包往返：globals 过滤空 key', pack.globals.length === 1 && pack.globals[0].key === 'token');

// 仅全局变量导出（全局变量页导出场景）
const onlyGlobals = parseImport(exportEnvironments([], globals));
check('仅全局变量：无环境', onlyGlobals.environments.length === 0);
check('仅全局变量：globals 保留', onlyGlobals.globals.length === 1);

// mergeVariables：同名覆盖 + 新增追加
const merged = mergeVariables(
  [{ key: 'token', value: 'old', enabled: false }, { key: 'keep', value: 'k', enabled: true }],
  [{ key: 'token', value: 'new', enabled: true }, { key: 'add', value: 'a', enabled: true }]
);
check('merge：同名覆盖值并启用', merged.find((v) => v.key === 'token').value === 'new' && merged.find((v) => v.key === 'token').enabled === true);
check('merge：保留未冲突变量', merged.find((v) => v.key === 'keep').value === 'k');
check('merge：追加新变量', merged.find((v) => v.key === 'add').value === 'a');
check('merge：总数正确', merged.length === 3);

// 备份文件格式校验逻辑（与 App.jsx handleRestoreBackup 一致）
const backup = { reqmock: true, version: 1, type: 'backup', data: { collections: [], environments: [env], settings: { theme: 'dark' } } };
const isValid = (b) => !!(b && b.reqmock === true && b.type === 'backup' && b.data);
check('备份格式：合法备份通过', isValid(JSON.parse(JSON.stringify(backup))));
check('备份格式：workspace 文件被拒', !isValid({ reqmock: true, type: 'workspace', collections: [] }));
check('备份格式：普通 JSON 被拒', !isValid({ foo: 1 }));

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
