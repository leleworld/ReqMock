/**
 * 请求检索：把集合树压成扁平索引，再按关键词匹配。
 *
 * 顶栏内嵌搜索框与 GlobalSearch（Ctrl+Shift+F 浮层）共用这一份实现——
 * 两处入口必须给出同样的结果，否则用户会怀疑自己搜错了。
 * 纯函数、无 React 依赖，便于单测。
 */

/** 单条请求的可搜索文本：名称 / URL / 参数 / Header，统一小写 */
function searchTextOf(r) {
  return [
    r.name || '',
    r.url || '',
    ...(r.params || []).map((p) => `${p.key || ''} ${p.value || ''}`),
    ...(r.headers || []).map((h) => `${h.key || ''} ${h.value || ''}`)
  ].join(' ').toLowerCase();
}

/**
 * 遍历集合树 → 扁平索引。
 * 文件夹用 ' › ' 连接成路径，供结果行右侧展示「这个请求在哪」。
 * @param {Array} collections
 * @returns {Array<{request: object, id: string, name: string, method: string, url: string, path: string, searchTexts: string}>}
 */
export function buildRequestIndex(collections) {
  const items = [];
  const walk = (node, path) => {
    const cur = [...path, node.name];
    for (const r of node.requests || []) {
      items.push({
        request: r,
        id: r.id,
        name: r.name || r.url || '未命名请求',
        method: r.method || 'GET',
        url: r.url || '',
        path: cur.join(' › '),
        searchTexts: searchTextOf(r)
      });
    }
    for (const f of node.folders || []) walk(f, cur);
  };
  for (const c of collections || []) walk(c, []);
  return items;
}

/**
 * 按关键词过滤索引。
 * 空查询返回空数组（而不是全部），因为「没输入」时展示全量列表没有意义。
 * @param {Array} index buildRequestIndex 的结果
 * @param {string} query
 * @param {number} limit 最多返回多少条
 */
export function searchRequests(index, query, limit = 50) {
  const q = String(query == null ? '' : query).trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const item of index || []) {
    if (item.searchTexts.includes(q)) {
      out.push(item);
      if (out.length >= limit) break;
    }
  }
  return out;
}
