/**
 * Cookie 管理：解析 Set-Cookie、按域名/路径匹配、构建请求 Cookie 头
 * jar 结构：[{ name, value, domain, path, expires, secure, hostOnly, createdAt }]
 */

/** 解析单条 Set-Cookie 原始串（结合请求 URL 补全域名/路径） */
export function parseSetCookie(raw, requestUrl) {
  if (!raw) return null;
  const parts = raw.split(';');
  const [name, ...vRest] = parts[0].split('=');
  if (!name || vRest.length === 0) return null;

  let host = '';
  let defaultPath = '/';
  try {
    const u = new URL(requestUrl);
    host = u.hostname;
    defaultPath = u.pathname.replace(/\/[^/]*$/, '') || '/';
  } catch (e) { /* 无 URL 时域名留空 */ }

  const cookie = {
    name: name.trim(),
    value: vRest.join('=').trim(),
    domain: host,
    hostOnly: true,
    path: defaultPath,
    expires: null, // null = 会话 Cookie
    secure: false,
    createdAt: Date.now()
  };

  let hasMaxAge = false;
  for (let i = 1; i < parts.length; i++) {
    const seg = parts[i].trim();
    const eq = seg.indexOf('=');
    const key = (eq < 0 ? seg : seg.slice(0, eq)).toLowerCase();
    const val = eq < 0 ? '' : seg.slice(eq + 1).trim();
    if (key === 'domain' && val) {
      cookie.domain = val.replace(/^\./, '');
      cookie.hostOnly = false;
    } else if (key === 'path' && val) {
      cookie.path = val;
    } else if (key === 'expires' && val) {
      if (!hasMaxAge) {
        const t = Date.parse(val);
        if (!Number.isNaN(t)) cookie.expires = t;
      }
    } else if (key === 'max-age' && val !== '') {
      const sec = parseInt(val, 10);
      if (!Number.isNaN(sec)) { cookie.expires = Date.now() + sec * 1000; hasMaxAge = true; }
    } else if (key === 'secure') {
      cookie.secure = true;
    }
  }
  return cookie;
}

/** 把新收到的 Set-Cookie 合并进 jar（同 domain+path+name 覆盖；过期即删除） */
export function upsertCookies(jar, setCookies, requestUrl) {
  let next = [...(jar || [])];
  for (const item of setCookies || []) {
    const c = parseSetCookie(typeof item === 'string' ? item : item.raw, typeof item === 'string' ? requestUrl : item.url);
    if (!c) continue;
    next = next.filter((x) => !(x.name === c.name && x.domain === c.domain && x.path === c.path));
    // 过期时间在过去 = 删除指令，不入 jar
    if (c.expires !== null && c.expires <= Date.now()) continue;
    next.push(c);
  }
  return next;
}

/** 域名匹配：hostOnly 精确匹配，否则允许子域 */
function domainMatch(cookieDomain, host, hostOnly) {
  if (!cookieDomain || !host) return false;
  if (host === cookieDomain) return true;
  if (hostOnly) return false;
  return host.endsWith('.' + cookieDomain);
}

/** 路径匹配（RFC 6265 简化版） */
function pathMatch(cookiePath, reqPath) {
  if (cookiePath === reqPath) return true;
  if (reqPath.startsWith(cookiePath)) {
    return cookiePath.endsWith('/') || reqPath[cookiePath.length] === '/';
  }
  return false;
}

/** 取出匹配某 URL 的有效 Cookie 列表 */
export function matchCookies(jar, requestUrl) {
  let u;
  try {
    u = new URL(requestUrl);
  } catch (e) {
    return [];
  }
  const now = Date.now();
  return (jar || []).filter((c) =>
    (c.expires === null || c.expires > now) &&
    domainMatch(c.domain, u.hostname, c.hostOnly) &&
    pathMatch(c.path || '/', u.pathname || '/') &&
    (!c.secure || u.protocol === 'https:')
  );
}

/** 构建 Cookie 请求头值；无匹配返回空串 */
export function buildCookieHeader(jar, requestUrl) {
  return matchCookies(jar, requestUrl).map((c) => `${c.name}=${c.value}`).join('; ');
}

/** 清理 jar 中已过期的 Cookie */
export function pruneCookies(jar) {
  const now = Date.now();
  return (jar || []).filter((c) => c.expires === null || c.expires > now);
}
