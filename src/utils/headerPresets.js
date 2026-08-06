/**
 * HTTP 请求头预设：内置常用组合 + 用户自定义，随应用设置持久化
 * preset 结构：{ id, name, builtIn?, rows: [{ key, value, enabled }] }
 */

let seq = 0;
const uid = () => 'hp-' + (++seq) + '-' + Math.random().toString(36).slice(2, 8);

export const DEFAULT_HEADER_PRESETS = [
  {
    id: 'builtin-json', name: 'JSON 接口', builtIn: true,
    rows: [
      { key: 'Content-Type', value: 'application/json', enabled: true },
      { key: 'Accept', value: 'application/json', enabled: true }
    ]
  },
  {
    id: 'builtin-browser', name: '浏览器常用', builtIn: true,
    rows: [
      { key: 'User-Agent', value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', enabled: true },
      { key: 'Accept', value: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', enabled: true },
      { key: 'Accept-Language', value: 'zh-CN,zh;q=0.9,en;q=0.8', enabled: true },
      { key: 'Accept-Encoding', value: 'gzip, deflate, br', enabled: true }
    ]
  },
  {
    id: 'builtin-form', name: '表单提交', builtIn: true,
    rows: [
      { key: 'Content-Type', value: 'application/x-www-form-urlencoded', enabled: true },
      { key: 'Accept', value: '*/*', enabled: true }
    ]
  },
  {
    id: 'builtin-nocache', name: '禁用缓存', builtIn: true,
    rows: [
      { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate', enabled: true },
      { key: 'Pragma', value: 'no-cache', enabled: true },
      { key: 'Expires', value: '0', enabled: true }
    ]
  },
  {
    id: 'builtin-bearer', name: 'Bearer 令牌', builtIn: true,
    rows: [
      { key: 'Authorization', value: 'Bearer {{token}}', enabled: true }
    ]
  }
];

/** 归一化存储的预设列表：非法条目剔除，保证 rows 结构完整 */
export function normalizePresets(list) {
  if (!Array.isArray(list) || list.length === 0) return DEFAULT_HEADER_PRESETS;
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

/** 应用预设到现有请求头：同名覆盖并启用，其余追加到末尾 */
export function applyPresetToHeaders(headers, preset) {
  const next = (headers || []).map((h) => ({ ...h }));
  for (const row of preset.rows) {
    if (!row.key) continue;
    const hit = next.find((h) => h.key.toLowerCase() === row.key.toLowerCase());
    if (hit) { hit.value = row.value; hit.enabled = row.enabled !== false; }
    else next.push({ key: row.key, value: row.value, enabled: row.enabled !== false });
  }
  return next;
}

export const newPresetId = uid;
