/**
 * URL 查询参数预设：内置常用组合 + 用户自定义，随应用设置持久化
 * preset 结构：{ id, name, builtIn?, rows: [{ key, value, enabled }] }
 */

let seq = 0;
const uid = () => 'pp-' + (++seq) + '-' + Math.random().toString(36).slice(2, 8);

export const DEFAULT_PARAM_PRESETS = [
  {
    id: 'builtin-pagination', name: '分页参数', builtIn: true,
    rows: [
      { key: 'page', value: '1', enabled: true },
      { key: 'pageSize', value: '20', enabled: true }
    ]
  },
  {
    id: 'builtin-pagination2', name: '分页参数（offset）', builtIn: true,
    rows: [
      { key: 'offset', value: '0', enabled: true },
      { key: 'limit', value: '20', enabled: true }
    ]
  },
  {
    id: 'builtin-timestamp', name: '时间戳防缓存', builtIn: true,
    rows: [
      { key: '_t', value: '{{$timestamp}}', enabled: true }
    ]
  },
  {
    id: 'builtin-sort', name: '排序参数', builtIn: true,
    rows: [
      { key: 'sortBy', value: 'createdAt', enabled: true },
      { key: 'order', value: 'desc', enabled: true }
    ]
  },
  {
    id: 'builtin-filter', name: '过滤参数', builtIn: true,
    rows: [
      { key: 'keyword', value: '', enabled: true },
      { key: 'status', value: 'active', enabled: true }
    ]
  }
];

/** 归一化存储的预设列表 */
export function normalizeParamPresets(list) {
  if (!Array.isArray(list) || list.length === 0) return DEFAULT_PARAM_PRESETS;
  return list
    .filter((p) => p && typeof p.name === 'string' && Array.isArray(p.rows))
    .map((p) => ({
      id: typeof p.id === 'string' ? p.id : uid(),
      name: p.name,
      builtIn: !!p.builtIn,
      rows: p.rows
        .filter((r) => r && typeof r.key === 'string')
        .map((r) => ({ key: r.key, value: r.value ?? '', enabled: r.enabled !== false }))
    }));
}

/** 应用预设到现有参数：同名覆盖并启用，其余追加到末尾 */
export function applyPresetToParams(params, preset) {
  const next = (params || []).map((p) => ({ ...p }));
  for (const row of preset.rows) {
    if (!row.key) continue;
    const hit = next.find((p) => p.key === row.key);
    if (hit) { hit.value = row.value; hit.enabled = row.enabled !== false; }
    else next.push({ key: row.key, value: row.value, enabled: row.enabled !== false });
  }
  return next;
}

export const newParamPresetId = uid;
