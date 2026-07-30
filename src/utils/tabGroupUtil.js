/**
 * 标签页分组（Chrome 式）：
 *   - 手动分组：右键把标签加入分组，可命名 / 换色 / 折叠
 *   - 自动分组：多个标签打开相同 URI 的接口时自动归入同一分组（忽略域名与端口，仅比较路径）
 * 数据模型：
 *   group = { id, name, color, collapsed, auto, urlKey, excludedTabIds? }
 *   tab.groupId 指向所属分组（无分组则为 undefined/null）
 *   excludedTabIds：被用户从组中移出的标签 id，自动归组不再把它们拉回
 */

/** 分组配色盘（Chrome 风格 8 色，循环取用） */
export const GROUP_COLORS = [
  '#4c8dff', '#e05f5f', '#e3b341', '#4caf7d',
  '#d96fbf', '#9a6fd9', '#3fbdc4', '#e08a4c'
];

/**
 * 归一化请求 URI 作为自动分组键：
 *   去协议 / 域名 / 端口 / query / hash / 尾斜杠，仅保留路径 ——
 *   同一接口部署在不同环境（如线上域名与本地端口）时也能归入同组。
 *   无路径的 URL 退化为 host（去端口小写），避免不同站点根地址误合并。
 */
export function urlGroupKey(url) {
  if (!url || !url.trim()) return '';
  let s = url.trim();
  // 去掉 query 与 hash
  const qi = s.search(/[?#]/);
  if (qi >= 0) s = s.slice(0, qi);
  // 拆出协议 / host / path，仅取 path；无 path 时退化为 host（去端口、小写）
  const m = s.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)?([^/]*)(\/.*)?$/);
  if (m) s = m[3] || (m[2] || '').replace(/:\d+$/, '').toLowerCase();
  // 去尾斜杠（根路径除外）
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

/** 自动分组名：取 URI 最后一段路径（无路径时用 host） */
export function groupNameFromKey(urlKey) {
  if (!urlKey) return '分组';
  const segs = urlKey.split('/').filter(Boolean);
  return segs.length > 1 ? segs[segs.length - 1] : segs[0] || '分组';
}

/** 挑选未被使用（或最少使用）的分组颜色 */
export function pickGroupColor(groups) {
  const used = groups.map((g) => g.color);
  const free = GROUP_COLORS.find((c) => !used.includes(c));
  return free || GROUP_COLORS[groups.length % GROUP_COLORS.length];
}

/** 重排标签：同组标签聚拢到该组首个成员之后，组间相对顺序不变 */
export function reorderTabsByGroup(tabs) {
  const result = [];
  const seen = new Set();
  for (const tab of tabs) {
    if (seen.has(tab.id)) continue;
    result.push(tab);
    seen.add(tab.id);
    if (tab.groupId) {
      for (const other of tabs) {
        if (!seen.has(other.id) && other.groupId === tab.groupId) {
          result.push(other);
          seen.add(other.id);
        }
      }
    }
  }
  return result;
}

/**
 * 自动分组核心：根据当前标签与分组，计算应有的分组分配。
 * 规则：
 *   - 仅对请求类标签生效，且不打扰手动分组（已在手动组内的标签不动）
 *   - 相同 urlKey 的 2+ 个标签 → 归入同一自动组（组按 urlKey 记忆，已存在则复用）
 *   - urlKey 相同的分组只保留最先出现的一个（历史残留的重复组自动合并），
 *     手动化的 URI 组也继续吸纳同 URI 的新标签，避免出现两个同名分组
 *   - excludedTabIds 中的标签（用户主动移出过）不再被拉回该组
 *   - 自动组成员不足 2 个时解散该组
 *   - dismissedKeys：用户主动解散过的自动组 urlKey，不再重建
 * 返回 { tabs, groups, changed }；changed=false 表示无需 setState。
 */
export function applyAutoGroups(tabs, groups, uuid, dismissedKeys) {
  const dismissed = dismissedKeys instanceof Set ? dismissedKeys : new Set(dismissedKeys || []);

  // 0. 合并 urlKey 重复的分组：任一方为手动则保持手动，排除名单取并集，成员改挂到保留组
  const keyIndex = new Map(); // urlKey -> mergedGroups 下标
  const remap = new Map();    // 被合并组 id -> 保留组 id
  const mergedGroups = [];
  for (const g of groups) {
    const idx = g.urlKey ? keyIndex.get(g.urlKey) : undefined;
    if (idx !== undefined) {
      const owner = mergedGroups[idx];
      remap.set(g.id, owner.id);
      mergedGroups[idx] = {
        ...owner,
        auto: owner.auto && g.auto,
        excludedTabIds: [...new Set([...(owner.excludedTabIds || []), ...(g.excludedTabIds || [])])]
      };
      continue;
    }
    if (g.urlKey) keyIndex.set(g.urlKey, mergedGroups.length);
    mergedGroups.push(g);
  }
  const baseTabs = remap.size === 0 ? tabs : tabs.map((t) => (
    t.groupId && remap.has(t.groupId) ? { ...t, groupId: remap.get(t.groupId) } : t
  ));

  const manualIds = new Set(mergedGroups.filter((g) => !g.auto).map((g) => g.id));
  // 1. 统计可自动分组标签的 urlKey
  const keyTabs = new Map(); // urlKey -> tabId[]
  for (const tab of baseTabs) {
    const isReq = !tab.kind || tab.kind === 'request';
    if (!isReq || (tab.groupId && manualIds.has(tab.groupId))) continue;
    const key = urlGroupKey(tab.request ? tab.request.url : '');
    if (!key) continue;
    if (!keyTabs.has(key)) keyTabs.set(key, []);
    keyTabs.get(key).push(tab.id);
  }

  // 2. 计算每个标签的目标 groupId：同 urlKey 的组已存在（含手动化的 URI 组）则直接吸纳，
  //    否则 2+ 成员才新建自动组；排除名单中的标签不参与
  let nextGroups = mergedGroups.slice();
  const target = new Map(); // tabId -> groupId
  for (const [key, ids] of keyTabs) {
    if (dismissed.has(key)) continue;
    let group = nextGroups.find((g) => g.urlKey === key);
    const excluded = new Set((group && group.excludedTabIds) || []);
    const eligible = ids.filter((id) => !excluded.has(id));
    if (!group) {
      if (eligible.length < 2) continue;
      group = {
        id: uuid(), name: groupNameFromKey(key), color: pickGroupColor(nextGroups),
        collapsed: false, auto: true, urlKey: key
      };
      nextGroups = [...nextGroups, group];
    }
    eligible.forEach((id) => target.set(id, group.id));
  }

  // 3. 应用目标分配：手动组成员保持，其余以 target 为准（不在 target 中则脱离自动组）
  let tabsChanged = remap.size > 0;
  let nextTabs = baseTabs.map((tab) => {
    const keep = tab.groupId && manualIds.has(tab.groupId);
    const want = keep ? tab.groupId : target.get(tab.id) || null;
    const cur = tab.groupId || null;
    if (want === cur) return tab;
    tabsChanged = true;
    return { ...tab, groupId: want || undefined };
  });

  // 4. 清理：自动组成员 <2 解散；手动组成员为 0 移除
  const counts = new Map();
  nextTabs.forEach((t) => {
    if (t.groupId) counts.set(t.groupId, (counts.get(t.groupId) || 0) + 1);
  });
  const kept = nextGroups.filter((g) => (g.auto ? (counts.get(g.id) || 0) >= 2 : (counts.get(g.id) || 0) > 0));
  const keptIds = new Set(kept.map((g) => g.id));
  nextTabs = nextTabs.map((t) => {
    if (t.groupId && !keptIds.has(t.groupId)) {
      tabsChanged = true;
      return { ...t, groupId: undefined };
    }
    return t;
  });

  // 5. 同组标签聚拢
  const ordered = reorderTabsByGroup(nextTabs);
  const orderChanged = ordered.some((t, i) => t.id !== tabs[i].id);
  const groupsChanged = kept.length !== groups.length || kept.some((g, i) => g !== groups[i]);
  return {
    tabs: ordered,
    groups: kept,
    changed: tabsChanged || orderChanged || groupsChanged
  };
}
