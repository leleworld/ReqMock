/**
 * 请求执行管线（UI 无关，可被单发调试与 Collection Runner 复用）：
 *   前置脚本 → 集合级 Headers/授权继承 → 变量替换 → 授权应用 → Cookie 附加 → 发送 → 后置脚本
 *
 * 通过 ctx.send 注入实际发送函数（渲染进程为 window.api.sendRequest，测试中可为任意实现），
 * 不直接触碰 React 状态与 window 对象。
 */
import { findOwnerCollection } from './collectionUtil.js';
import { resolveRequest } from './envUtil.js';
import { applyAuth } from './authUtil.js';
import { runScript } from './scriptRunner.js';
import { buildCookieHeader } from './cookieUtil.js';

function genUuid() {
  return crypto.randomUUID();
}

/**
 * 执行单个请求的完整管线。
 * @param {object} reqSnapshot 请求快照（不会被修改）
 * @param {object} ctx
 *   - collections: 集合树（用于集合级 Headers/授权继承），默认 []
 *   - varMap: 变量表（全局+环境+数据行已合并），默认 {}
 *   - settings: 应用设置（cookiesEnabled）
 *   - cookieJar: Cookie 罐
 *   - send: async (payload) => result 实际发送函数（必填）
 *   - cancelToken: 可选取消令牌，附加到发送 payload
 * @returns {Promise<{result, finalReq, logs, tests, errors, envSet, envUnset}>}
 */
export async function executeRequest(reqSnapshot, ctx) {
  const {
    collections = [],
    varMap: baseVarMap = {},
    settings = {},
    cookieJar = [],
    send,
    cancelToken = null
  } = ctx;

  const errors = [];
  let logs = [];
  let tests = [];
  let envSet = {};
  let envUnset = [];
  let varMap = { ...baseVarMap };
  let req = JSON.parse(JSON.stringify(reqSnapshot));

  const mergeEnvChanges = (r) => {
    envSet = { ...envSet, ...r.envSet };
    for (const k of r.envUnset) {
      delete envSet[k];
      if (!envUnset.includes(k)) envUnset.push(k);
    }
    envUnset = envUnset.filter((k) => !Object.prototype.hasOwnProperty.call(r.envSet, k));
  };

  // 1. 前置脚本
  if (req.preScript && req.preScript.trim()) {
    const r = await runScript(req.preScript, { request: req, response: null, varMap });
    logs = logs.concat(r.logs);
    tests = tests.concat(r.tests);
    if (!r.ok) errors.push('前置脚本：' + r.error);
    req = r.request || req;
    varMap = { ...varMap, ...r.envSet };
    r.envUnset.forEach((k) => delete varMap[k]);
    mergeEnvChanges(r);
  }

  // 2. 集合级公共 Headers 合并（请求内同名优先）+ 授权继承
  const owner = findOwnerCollection(collections, reqSnapshot.id);
  if (owner && (owner.headers || []).length > 0) {
    const existing = new Set(
      (req.headers || []).filter((h) => h.enabled !== false && h.key).map((h) => h.key.toLowerCase())
    );
    const inherited = owner.headers.filter(
      (h) => h.enabled !== false && h.key && !existing.has(h.key.toLowerCase())
    );
    req = { ...req, headers: [...(req.headers || []), ...inherited] };
  }
  if (owner && owner.auth && owner.auth.type !== 'none' && (!req.auth || req.auth.type === 'none')) {
    req = { ...req, auth: owner.auth };
  }

  // 3. 变量替换 + 授权应用 + Cookie 附加
  let finalReq = applyAuth(resolveRequest(req, varMap));
  const cookieOn = finalReq.cookieJarMode === 'on' ||
    (finalReq.cookieJarMode !== 'off' && settings.cookiesEnabled);
  if (cookieOn) {
    const hasManualCookie = (finalReq.headers || []).some(
      (h) => h.enabled !== false && h.key && h.key.toLowerCase() === 'cookie'
    );
    const cookieHeader = hasManualCookie ? '' : buildCookieHeader(cookieJar, finalReq.url);
    if (cookieHeader) {
      finalReq = { ...finalReq, headers: [...(finalReq.headers || []), { key: 'Cookie', value: cookieHeader, enabled: true }] };
    }
  }
  if (finalReq.injectId) {
    finalReq = { ...finalReq, headers: [...(finalReq.headers || []), { key: 'ReqMock-Id', value: genUuid(), enabled: true }] };
  }

  // 4. 发送
  // 注入 settings 中的网络配置到发送 payload
  const netOpts = {};
  if (settings.timeout != null) netOpts.timeoutMs = settings.timeout * 1000;
  if (settings.sslVerify != null) netOpts.sslVerify = settings.sslVerify;
  if (settings.maxRedirects != null) netOpts.maxRedirects = settings.maxRedirects;
  const basePayload = { ...finalReq, ...netOpts };
  const payload = cancelToken ? { ...basePayload, cancelToken } : basePayload;
  const result = await send(payload);

  // 5. 后置脚本
  if (req.postScript && req.postScript.trim()) {
    const scriptResponse = result.ok
      ? result
      : { status: 0, statusText: 'ERROR', headers: {}, body: result.error || '', errorCode: result.errorCode || '', timeMs: result.timeMs };
    const r = await runScript(req.postScript, { request: finalReq, response: scriptResponse, varMap });
    logs = logs.concat(r.logs);
    tests = tests.concat(r.tests);
    if (!r.ok) errors.push('后置脚本：' + r.error);
    mergeEnvChanges(r);
  }

  return { result, finalReq, logs, tests, errors, envSet, envUnset, cookieOn };
}
