/**
 * 请求授权工具：none / basic / bearer / apikey
 * 发送前把授权配置转换为对应的 Header 或 Query 参数
 */

export const AUTH_TYPES = [
  { value: 'none', label: '无授权' },
  { value: 'basic', label: 'Basic Auth' },
  { value: 'bearer', label: 'Bearer Token' },
  { value: 'apikey', label: 'API Key' }
];

export function newAuth() {
  return { type: 'none', username: '', password: '', token: '', key: '', value: '', addTo: 'header' };
}

/** 规范化授权对象，补齐缺失字段（兼容旧数据） */
export function normalizeAuth(auth) {
  return { ...newAuth(), ...(auth || {}) };
}

/** UTF-8 安全的 base64 编码（浏览器与 Node 均可用） */
function b64(s) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(s, 'utf8').toString('base64');
  }
  return btoa(unescape(encodeURIComponent(s)));
}

function hasEnabledHeader(headers, name) {
  return (headers || []).some(
    (h) => h.enabled !== false && h.key && h.key.toLowerCase() === name.toLowerCase()
  );
}

/**
 * 应用授权配置：附加 Header / Query 参数并返回新请求对象。
 * 请求中已手动填写同名启用 Header 时不覆盖。
 */
export function applyAuth(request) {
  const auth = request.auth;
  if (!auth || auth.type === 'none') return request;

  const headers = [...(request.headers || [])];
  const params = [...(request.params || [])];

  if (auth.type === 'basic') {
    if (!hasEnabledHeader(headers, 'Authorization')) {
      headers.push({
        key: 'Authorization',
        value: 'Basic ' + b64(`${auth.username || ''}:${auth.password || ''}`),
        enabled: true
      });
    }
  } else if (auth.type === 'bearer') {
    if (!hasEnabledHeader(headers, 'Authorization')) {
      headers.push({ key: 'Authorization', value: 'Bearer ' + (auth.token || ''), enabled: true });
    }
  } else if (auth.type === 'apikey' && auth.key) {
    if (auth.addTo === 'query') {
      params.push({ key: auth.key, value: auth.value || '', enabled: true });
    } else if (!hasEnabledHeader(headers, auth.key)) {
      headers.push({ key: auth.key, value: auth.value || '', enabled: true });
    }
  }
  return { ...request, headers, params };
}
