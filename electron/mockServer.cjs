/**
 * Mock 服务引擎
 * 路由匹配：method + path（支持 :param 占位符与 * 通配）
 * 响应模板：{{params.x}} {{query.x}} {{header.x}} {{body.x}} {{now}} {{uuid}} {{random.*}}
 * 条件响应：route.rules 按 query/header/param/body 匹配返回不同响应（见 mockRender.cjs）
 */
const http = require('http');
const crypto = require('crypto');
const { renderTemplate, pickRule } = require('./mockRender.cjs');
const { runMockScript } = require('./mockScript.cjs');

class MockServer {
  /**
   * @param onLog 每次收到 mock 请求时回调日志条目
   */
  constructor(onLog) {
    this.server = null;
    this.port = null;
    this.routes = [];
    this.onLog = onLog || (() => {});
  }

  start(config) {
    const { port, routes = [] } = config;
    this.routes = routes;
    return new Promise(async (resolve, reject) => {
      if (this.server) {
        await this.stop();
      }
      const server = http.createServer((req, res) => this.handle(req, res));
      server.on('error', (e) => {
        this.server = null;
        reject(e.code === 'EADDRINUSE' ? new Error(`端口 ${port} 已被占用`) : e);
      });
      server.listen(port, () => {
        this.server = server;
        this.port = port;
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
        this.server = null;
        this.port = null;
      } else {
        resolve();
      }
    });
  }

  status() {
    return { running: !!this.server, port: this.port };
  }

  updateRoutes(routes) {
    this.routes = routes;
  }

  handle(req, res) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const urlObj = new URL(req.url, `http://localhost:${this.port}`);
      const pathName = urlObj.pathname;

      // CORS 预检直接放行
      if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders());
        res.end();
        return;
      }

      const matched = this.matchRoute(req.method, pathName);
      const logEntry = {
        id: crypto.randomUUID(),
        time: new Date().toISOString(),
        method: req.method,
        path: pathName + urlObj.search,
        matched: !!matched,
        routeName: matched ? matched.route.name : null,
        status: null
      };

      if (!matched) {
        logEntry.status = 404;
        this.onLog(logEntry);
        res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders() });
        res.end(JSON.stringify({ error: 'no mock route matched', method: req.method, path: pathName }));
        return;
      }

      const { route, params } = matched;
      const context = this.buildContext(req, urlObj, params, rawBody);

      let status;
      let responseBody;
      let routeHeaders = route.headers || [];
      let delay = parseInt(route.delayMs, 10) || 0;

      if (route.responseMode === 'script' && (route.script || '').trim()) {
        // 脚本化响应：vm 沙箱执行，脚本异常/超时返回 500
        const scriptReq = {
          method: req.method,
          path: pathName,
          params: context.params,
          query: context.query,
          headers: context.header,
          body: context.body
        };
        const r = runMockScript(route.script, scriptReq);
        if (r.ok) {
          status = r.status;
          responseBody = r.body;
          routeHeaders = Object.entries(r.headers).map(([key, value]) => ({ key, value, enabled: true }));
        } else {
          status = 500;
          responseBody = JSON.stringify({ error: 'mock script error', message: r.error });
          routeHeaders = [];
          logEntry.scriptError = r.error;
        }
      } else {
        // 模板响应：条件规则命中时用规则的 status/headers/body/delay 覆盖默认值
        const rule = pickRule(route.rules, context);
        const src = rule || route;
        status = parseInt(src.status, 10) || parseInt(route.status, 10) || 200;
        responseBody = renderTemplate(src.body ?? route.body ?? '', context);
        if (rule && Array.isArray(rule.headers) && rule.headers.length) routeHeaders = rule.headers;
        if (rule && rule.delayMs != null) delay = parseInt(rule.delayMs, 10) || 0;
        if (rule) logEntry.ruleName = rule.name || '条件规则';
      }
      logEntry.status = status;

      const headers = { ...corsHeaders() };
      let hasContentType = false;
      for (const h of routeHeaders) {
        if (h.enabled !== false && h.key) {
          headers[h.key] = h.value ?? '';
          if (h.key.toLowerCase() === 'content-type') {
            hasContentType = true;
          }
        }
      }
      if (!hasContentType) {
        headers['Content-Type'] = 'application/json; charset=utf-8';
      }

      setTimeout(() => {
        this.onLog(logEntry);
        res.writeHead(status, headers);
        res.end(responseBody);
      }, delay);
    });
  }

  /**
   * 依次匹配启用的路由，支持 :param 与 * 通配
   */
  matchRoute(method, pathName) {
    for (const route of this.routes) {
      if (route.enabled === false) {
        continue;
      }
      if (route.method !== 'ANY' && route.method !== method) {
        continue;
      }
      const params = matchPath(route.path, pathName);
      if (params !== null) {
        return { route, params };
      }
    }
    return null;
  }

  buildContext(req, urlObj, params, rawBody) {
    const query = {};
    urlObj.searchParams.forEach((value, key) => {
      query[key] = value;
    });
    const header = {};
    for (const [k, v] of Object.entries(req.headers)) {
      header[k.toLowerCase()] = Array.isArray(v) ? v.join(',') : v;
    }
    let bodyJson = {};
    try {
      bodyJson = JSON.parse(rawBody);
    } catch (e) {
      // 非 JSON body 忽略
    }
    return { params, query, header, body: bodyJson };
  }
}

/**
 * 路径匹配：/user/:id 匹配 /user/123 → {id:'123'}；* 匹配任意剩余段
 * @returns 参数对象；不匹配返回 null
 */
function matchPath(pattern, pathName) {
  if (!pattern) {
    return null;
  }
  const patternSegs = pattern.split('/').filter(s => s !== '');
  const pathSegs = pathName.split('/').filter(s => s !== '');
  const params = {};

  for (let i = 0; i < patternSegs.length; i++) {
    const pSeg = patternSegs[i];
    if (pSeg === '*') {
      return params;
    }
    if (i >= pathSegs.length) {
      return null;
    }
    if (pSeg.startsWith(':')) {
      params[pSeg.substring(1)] = decodeURIComponent(pathSegs[i]);
    } else if (pSeg !== pathSegs[i]) {
      return null;
    }
  }
  return patternSegs.length === pathSegs.length ? params : null;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
    'Access-Control-Allow-Headers': '*'
  };
}

module.exports = { MockServer };
