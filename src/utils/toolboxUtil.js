/**
 * 小工具箱：编解码 / 时间戳转换 / UUID 生成
 * 全部为纯函数，浏览器与 Node 环境均可用
 */

/** UTF-8 安全 Base64 编码 */
export function b64Encode(s) {
  if (typeof Buffer !== 'undefined') return Buffer.from(String(s ?? ''), 'utf8').toString('base64');
  return btoa(unescape(encodeURIComponent(String(s ?? ''))));
}

/** UTF-8 安全 Base64 解码，非法输入抛错 */
export function b64Decode(s) {
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(String(s ?? '').trim(), 'base64');
    if (buf.length === 0 && String(s ?? '').trim() !== '') throw new Error('不是合法的 Base64');
    return buf.toString('utf8');
  }
  return decodeURIComponent(escape(atob(String(s ?? '').trim())));
}

export function urlEncode(s) {
  return encodeURIComponent(String(s ?? ''));
}

export function urlDecode(s) {
  return decodeURIComponent(String(s ?? '').replace(/\+/g, '%20'));
}

/** JSON 字符串转义（不含首尾引号） */
export function jsonEscape(s) {
  return JSON.stringify(String(s ?? '')).slice(1, -1);
}

/** JSON 字符串反转义 */
export function jsonUnescape(s) {
  return JSON.parse(`"${String(s ?? '')}"`);
}

/** Unicode 转义：非 ASCII 字符转为 \uXXXX */
export function unicodeEscape(s) {
  return String(s ?? '').replace(/[^\x00-\x7f]/g, (c) =>
    '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
  );
}

/** Unicode 反转义 */
export function unicodeUnescape(s) {
  return String(s ?? '').replace(/\\u([0-9a-fA-F]{4})/g, (m, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

/**
 * 时间戳 → 本地时间字符串（自动识别秒/毫秒）
 * @returns { date, unit } 或抛错
 */
export function tsToDate(input) {
  const n = Number(String(input).trim());
  if (!Number.isFinite(n)) throw new Error('不是合法的数字');
  // 13 位按毫秒，10 位按秒
  const ms = Math.abs(n) < 1e12 ? n * 1000 : n;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) throw new Error('无法转换为时间');
  return { date: formatDate(d), unit: Math.abs(n) < 1e12 ? '秒' : '毫秒' };
}

/** 日期字符串 → 时间戳（秒与毫秒） */
export function dateToTs(input) {
  const d = new Date(String(input).trim().replace(/-/g, '/'));
  if (Number.isNaN(d.getTime())) throw new Error('无法解析的日期格式');
  return { seconds: Math.floor(d.getTime() / 1000), millis: d.getTime() };
}

export function formatDate(d) {
  const p = (n, len = 2) => String(n).padStart(len, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** 批量生成 UUID v4 */
export function genUuids(count = 1) {
  const n = Math.max(1, Math.min(100, count | 0));
  return Array.from({ length: n }, () => crypto.randomUUID());
}

/** base64url → 标准 base64 */
function b64UrlToStd(s) {
  const t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  return t + '='.repeat((4 - (t.length % 4)) % 4);
}

/**
 * 尝试将选中文本识别为 JWT 或 Base64 并解码（响应体选中即时提示用）
 * @returns { kind: 'jwt'|'base64', text } 或 null
 */
export function tryDecodeSelection(raw) {
  const s = String(raw || '').trim().replace(/^["']|["']$/g, '');
  if (s.length < 8 || /\s/.test(s)) return null;

  // JWT：三段 base64url，头部与载荷均为 JSON
  const jwtParts = s.split('.');
  if (jwtParts.length === 3 && jwtParts.every((p) => /^[\w-]+$/.test(p))) {
    try {
      const header = JSON.parse(b64Decode(b64UrlToStd(jwtParts[0])));
      const payload = JSON.parse(b64Decode(b64UrlToStd(jwtParts[1])));
      if (header && header.alg) {
        return { kind: 'jwt', text: 'Header: ' + JSON.stringify(header) + '\nPayload: ' + JSON.stringify(payload, null, 2) };
      }
    } catch (e) { /* 非 JWT，继续尝试 Base64 */ }
  }

  // Base64：合法字符且解码后为可打印文本
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length % 4 === 0) {
    try {
      const decoded = b64Decode(s);
      // 含控制字符（除常见空白）视为二进制，不提示
      if (decoded && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(decoded) && /[\x20-\x7e\u4e00-\u9fff]{3,}/.test(decoded)) {
        return { kind: 'base64', text: decoded };
      }
    } catch (e) { /* 非合法 Base64 */ }
  }
  return null;
}
