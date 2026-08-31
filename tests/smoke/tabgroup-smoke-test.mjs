/**
 * 标签分组冒烟测试（无 GUI）：
 *   node tabgroup-smoke-test.mjs
 * 覆盖：URI 归一化 / 自动分组建立与解散 / 手动分组保护 / 折叠聚拢排序 / dismissed 抑制
 *       同键重复组合并 / 手动化 URI 组吸纳新标签 / excludedTabIds 不拉回
 */
import {
  urlGroupKey, groupNameFromKey, pickGroupColor,
  reorderTabsByGroup, applyAutoGroups, GROUP_COLORS
} from './src/utils/tabGroupUtil.js';

let passed = 0, failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log('  [PASS] ' + name); }
  else { failed++; console.log('  [FAIL] ' + name); }
}

let seq = 0;
const uuid = () => 'g' + (++seq);
const reqTab = (id, url, groupId) => ({ id, kind: 'request', request: { url }, groupId });

// ---- 1. URI 归一化 ----
check('urlGroupKey 去 query/hash', urlGroupKey('http://a.com/api/user?id=1#top') === '/api/user');
check('urlGroupKey 路径匹配忽略域名', urlGroupKey('https://a.com/api/user') === urlGroupKey('http://b.com/api/user'));
check('urlGroupKey 路径区分大小写', urlGroupKey('http://A.COM/Api/User') === '/Api/User');
check('urlGroupKey 去尾斜杠', urlGroupKey('http://a.com/api/') === '/api');
check('urlGroupKey 空 URL 返回空', urlGroupKey('') === '' && urlGroupKey('   ') === '');
check('urlGroupKey 无协议原样归一', urlGroupKey('a.com/api?x=1') === '/api');
check('urlGroupKey 无路径退化为 host', urlGroupKey('http://a.com') === 'a.com' && urlGroupKey('http://a.com:8080') === 'a.com');
check('urlGroupKey 不同域名+相同路径合并',
  urlGroupKey('http://10.18.210.168/api/v1.2.0/searchApi/directWord') ===
  urlGroupKey('http://localhost:16407/api/v1.2.0/searchApi/directWord'));
check('groupNameFromKey 取最后路径段', groupNameFromKey('/api/v1/search') === 'search');
check('groupNameFromKey 无路径用 host', groupNameFromKey('a.com') === 'a.com');

// ---- 2. 颜色分配 ----
check('pickGroupColor 优先未用颜色',
  pickGroupColor([{ color: GROUP_COLORS[0] }]) === GROUP_COLORS[1]);
check('pickGroupColor 用尽后循环',
  GROUP_COLORS.includes(pickGroupColor(GROUP_COLORS.map((c) => ({ color: c })))));

// ---- 3. 同组聚拢排序 ----
const scattered = [
  reqTab('t1', 'u1', 'ga'), reqTab('t2', 'u2'), reqTab('t3', 'u3', 'ga'), reqTab('t4', 'u4')
];
const ordered = reorderTabsByGroup(scattered);
check('reorderTabsByGroup 同组聚拢', ordered.map((t) => t.id).join(',') === 't1,t3,t2,t4');
check('reorderTabsByGroup 不丢标签', ordered.length === 4);

// ---- 4. 自动分组：建立 ----
const tabs1 = [
  reqTab('a', 'http://x.com/api/login'),
  reqTab('b', 'http://x.com/api/user'),
  reqTab('c', 'https://x.com/api/login?t=2')
];
const r1 = applyAutoGroups(tabs1, [], uuid);
check('相同 URI 自动建组', r1.changed && r1.groups.length === 1 && r1.groups[0].auto);
check('自动组名取路径段', r1.groups[0].name === 'login');
const gid1 = r1.groups[0].id;
check('同 URI 标签归入组',
  r1.tabs.find((t) => t.id === 'a').groupId === gid1 &&
  r1.tabs.find((t) => t.id === 'c').groupId === gid1 &&
  !r1.tabs.find((t) => t.id === 'b').groupId);
check('组内标签聚拢相邻', r1.tabs.map((t) => t.id).join(',') === 'a,c,b');

// 不动点：再次应用无变化
const r2 = applyAutoGroups(r1.tabs, r1.groups, uuid);
check('自动分组结果稳定（不循环）', r2.changed === false);

// ---- 5. 自动分组：解散 ----
const r3 = applyAutoGroups(r1.tabs.filter((t) => t.id !== 'c'), r1.groups, uuid);
check('成员不足 2 自动解散', r3.changed && r3.groups.length === 0 &&
  r3.tabs.every((t) => !t.groupId));

// URL 改变后脱组
const changedUrl = r1.tabs.map((t) => (t.id === 'c' ? { ...t, request: { url: 'http://x.com/other' } } : t));
const r4 = applyAutoGroups(changedUrl, r1.groups, uuid);
check('URL 改变后脱离原组并解散', r4.groups.length === 0);

// ---- 6. 手动分组保护 ----
const manual = { id: 'mg', name: '联调', color: '#fff', collapsed: false, auto: false };
const tabs2 = [
  reqTab('a', 'http://x.com/api/login', 'mg'),
  reqTab('b', 'http://x.com/api/login'),
  reqTab('d', 'http://x.com/api/login')
];
const r5 = applyAutoGroups(tabs2, [manual], uuid);
check('手动组成员不被自动逻辑挪动', r5.tabs.find((t) => t.id === 'a').groupId === 'mg');
check('组外同 URI 标签仍可自动建组',
  r5.groups.length === 2 &&
  r5.tabs.find((t) => t.id === 'b').groupId === r5.tabs.find((t) => t.id === 'd').groupId &&
  r5.tabs.find((t) => t.id === 'b').groupId !== 'mg');
check('空手动组被清理', applyAutoGroups([reqTab('z', 'u')], [manual], uuid).groups.length === 0);

// ---- 7. dismissed 抑制重建 ----
const r6 = applyAutoGroups(tabs1, [], uuid, new Set([urlGroupKey('http://x.com/api/login')]));
check('解散过的自动组不再重建', r6.groups.length === 0);

// ---- 8. 页面类标签不参与自动分组 ----
const r7 = applyAutoGroups([
  { id: 'p1', kind: 'mock' }, { id: 'p2', kind: 'cookies' },
  reqTab('a', 'http://x.com/api/login')
], [], uuid);
check('页面标签不参与自动分组', r7.groups.length === 0 && r7.changed === false);

// ---- 9. 同 urlKey 重复分组合并（历史残留的同名组不再并存） ----
const dupA = { id: 'dg1', name: 'login', color: '#111', collapsed: false, auto: false, urlKey: '/api/login' };
const dupB = { id: 'dg2', name: 'login', color: '#222', collapsed: false, auto: true, urlKey: '/api/login' };
const dupTabs = [
  reqTab('a', 'http://x.com/api/login', 'dg1'),
  reqTab('b', 'http://y.com/api/login', 'dg1'),
  reqTab('c', 'http://x.com/api/login', 'dg2'),
  reqTab('d', 'https://z.com/api/login?q=1', 'dg2')
];
const r8 = applyAutoGroups(dupTabs, [dupA, dupB], uuid);
check('同键重复组合并为一个', r8.changed && r8.groups.length === 1 && r8.groups[0].id === 'dg1');
check('合并后保持手动属性', r8.groups[0].auto === false);
check('被合并组成员改挂到保留组', r8.tabs.every((t) => t.groupId === 'dg1'));

// ---- 10. 手动化的 URI 组继续吸纳同 URI 新标签（不再新建同名组） ----
const keyedManual = { id: 'km', name: 'login', color: '#333', collapsed: false, auto: false, urlKey: '/api/login' };
const r9 = applyAutoGroups([
  reqTab('a', 'http://x.com/api/login', 'km'),
  reqTab('b', 'http://x.com/api/login', 'km'),
  reqTab('n1', 'http://dev.local:8080/api/login'),
  reqTab('n2', 'http://x.com/api/login')
], [keyedManual], uuid);
check('同 URI 新标签并入已有组而非新建同名组',
  r9.groups.length === 1 &&
  r9.tabs.find((t) => t.id === 'n1').groupId === 'km' &&
  r9.tabs.find((t) => t.id === 'n2').groupId === 'km');

// ---- 11. excludedTabIds：被移出的标签不拉回，其他同 URI 标签照常归组 ----
const exGroup = {
  id: 'eg', name: 'login', color: '#444', collapsed: false, auto: true,
  urlKey: '/api/login', excludedTabIds: ['out']
};
const r10 = applyAutoGroups([
  reqTab('a', 'http://x.com/api/login', 'eg'),
  reqTab('b', 'http://x.com/api/login', 'eg'),
  reqTab('out', 'http://x.com/api/login'),
  reqTab('n3', 'http://x.com/api/login')
], [exGroup], uuid);
check('排除名单标签不被拉回',
  !r10.tabs.find((t) => t.id === 'out').groupId &&
  r10.tabs.find((t) => t.id === 'n3').groupId === 'eg' &&
  r10.groups.length === 1);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
