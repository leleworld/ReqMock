# ReqMock 全功能 Bug 排查报告

> 排查范围：HTTP 客户端、Mock 服务、WebSocket/SSE、Cookie 管理、环境变量、脚本执行、Collection Runner、URL 同步、自动更新 排查时间：2026-08-13

---

## 🚨 严重 Bug（会导致功能异常或数据丢失）

### BUG-01: HTTP/2 连接未正确关闭 — 内存泄漏

**文件**: `electron/httpClient.cjs` → `doH2Request()` **问题**: 当 H2 请求在 `req.on('error')` 触发时，`settled` 设为 `true` 并在 `fail()` 中关闭 client，但如果 error 发生在 `req.on('response')` 回调已执行之后（即已经有 `data` 事件在监听），`res.on('end')` 可能仍然会尝试 `client.close()` 造成 double-close。更关键的是：**重定向链路中 H2 请求的 client 未被关闭**。

每次重定向 hop 都调用 `doH2Request`，每次建立新的 `http2.connect()` 连接，但连接只在最后一跳的 `end` 或 `fail` 中关闭。中间跳的 client 永远没关闭。

**影响**: 频繁请求带 H2 重定向的 URL 时，h2 session 泄漏，最终进程内存暴涨。 **修复建议**: 在 `doSingleRequest` / `doH2Request` 的 `resolve` 路径中确保 client 关闭；或在重定向循环的每一跳结束后关闭上一跳的连接。

---

### BUG-02: Mock 服务 `start()` 竞态 — server.close() 返回 Promise 但未 await

**文件**: `electron/mockServer.cjs` → `start()`

```javascript
if (this.server) {
  this.stop(); // ← 返回 Promise，但没 await！
}
const server = http.createServer(...);
server.listen(port, ...); // 旧 server 可能尚未释放端口 → EADDRINUSE

```

**影响**: 快速重启 Mock 服务时（改端口后立即点启动），偶现端口占用错误。 **修复**: `await this.stop();`

---

### BUG-03: `collectRunnableRequests` 读取不存在的字段

**文件**: `src/utils/runnerUtil.js`

```javascript
let out = (node.requests || []).map(...)  // ← 集合节点没有 .requests 字段！
for (const f of node.folders || []) ...   // ← 也没有 .folders 字段！

```

**实际数据结构**（从 `collectionUtil.js`）: 集合/文件夹用 `children` 数组，请求是 leaf 节点（`type` 不是 'folder'/'collection'）。 **影响**: Collection Runner 永远收集不到任何请求 → 批量运行空跑。 **修复**: 遍历 `node.children`，按 `type` 区分递归子文件夹和收集请求。

---

### BUG-04: 脚本 `rm.env.set` 不持久化 — envUnset 类型不一致

**文件**: `src/utils/scriptRunner.js`

```javascript
const envUnset = new Set();  // ← Set
// ...
return { ..., envUnset: [...envUnset], ... };  // 展开为数组 ✓

```

**但在** `src/utils/requestPipeline.js`:

```javascript
for (const k of r.envUnset) { ... }  // 迭代数组 ✓
envUnset = envUnset.filter((k) => !(k in r.envSet)); // ← `in` 对数组无效！

```

`"someKey" in ["someKey"]` → 永远为 `false`（`in` 检查的是索引不是值）。 **影响**: `rm.env.unset(key)` 后如果同一脚本又 `rm.env.set(key, ...)` 对同一 key，unset 不会被正确清除 → 环境变量被意外删除。 **修复**: `envUnset = envUnset.filter((k) => !r.envSet.hasOwnProperty(k));` 或使用 `Object.keys(r.envSet).includes(k)`

---

### BUG-05: 搜索结果滚动失效（已在本次会话修复 ✅）

**文件**: `src/components/CodeEditor.jsx` **原因**: `view.scrollIntoView()` 不是 CM6 实例方法，应用 `view.dispatch({ effects: EditorView.scrollIntoView() })`

---

## ⚠️ 中等 Bug（特定场景下触发）

### BUG-06: HTTP 代理 HTTPS 隧道 — DNS 耗时永远为 0

**文件**: `electron/httpClient.cjs` 走代理 CONNECT 隧道时，DNS 解析由代理服务器完成，但 `socket.once('lookup')` 监听器挂在隧道 socket 上（已由 `connectTunnel` 返回的已连接 socket），此事件永远不触发。 **影响**: 代理模式下耗时面板 DNS 永远显示 -1/0，用户误判。 **修复**: 代理模式标记 `timings.dns = 0` 并注明 "由代理解析"。

---

### BUG-07: Mock `matchPath` — 尾部斜杠不匹配

**文件**: `electron/mockServer.cjs` → `matchPath()`

```javascript
// pattern: /api/users   path: /api/users/  → pathSegs=['api','users','']
// filter(s => s !== '') 后 pathSegs=['api','users'] → 匹配 ✓
// BUT: pattern: /api/users/  path: /api/users  → patternSegs=['api','users'] pathSegs=['api','users'] → 匹配 ✓

```

实际上空字符串过滤解决了大部分情况，**但**：

```
pattern: /api/:id/*  path: /api/123  → patternSegs 有 3 段, pathSegs 只有 2 段

```

当 `*` 不在最后一段时结果正确（遇到 `*` 直接 return），但当路径 `/api/` 只有空尾部时 `pathSegs` 为 `['api']`（1段）而 pattern `/api/:id` 有 2 段 → 循环中 `i >= pathSegs.length` 返回 null。 **影响**: `:param` 可选尾部路径不匹配。 **修复建议**: 文档明确 pattern 约定；或增加可选参数语法 `:id?`。

---

### BUG-08: Cookie `parseSetCookie` — `max-age` 优先级未正确实现

**文件**: `src/utils/cookieUtil.js` RFC 6265 规定 `max-age` 优先于 `expires`，但当前代码按出现顺序赋值：如果 `expires` 在 `max-age` 之后出现，会覆盖 max-age 的计算结果。

```javascript
} else if (key === 'expires' && val) {
  const t = Date.parse(val); if (!Number.isNaN(t)) cookie.expires = t;
} else if (key === 'max-age' && val !== '') {
  const sec = parseInt(val, 10); if (!Number.isNaN(sec)) cookie.expires = Date.now() + sec * 1000;
}

```

**影响**: `Set-Cookie: a=1; max-age=3600; expires=Thu, 01 Jan 1970` 应存活 1 小时，实际被判定为已过期。 **修复**: 先收集所有属性，最后按优先级决定 expires（max-age > expires）。

---

### BUG-09: `lightEncode` 不处理 `%` 字符

**文件**: `src/utils/urlSync.js`

```javascript
function lightEncode(s) {
  return String(s ?? '').replace(/[&=#+\s]/g, (c) => encodeURIComponent(c === ' ' ? ' ' : c));
}

```

`%` 未在替换列表中，如果用户输入 `50%off`，会导致 URL 中出现 `50%off`（裸 `%`），服务器解析可能报错或截断。 **影响**: 含 `%` 的参数值发送后可能损坏。 **修复**: 添加 `%` 到替换列表，或改用更完整的编码策略。

---

### BUG-10: Mock 脚本沙箱可逃逸 — `JSON` 全局共享

**文件**: `electron/mockScript.cjs`

```javascript
const sandbox = { request, response, JSON, Math, Date };

```

传入的 `JSON` 是宿主环境的全局 `JSON` 对象，脚本可以修改 `JSON.stringify`：

```javascript
JSON.stringify = () => "hacked";

```

之后主进程所有 `JSON.stringify` 调用都被污染。 **影响**: 恶意/错误的 Mock 脚本可破坏整个应用的 JSON 处理。 **修复**:

```javascript
const sandbox = { request, response, JSON: Object.freeze({...JSON}), Math, Date };
// 或在 vm.createContext 前冻结

```

---

### BUG-11: SSE 未处理非 200 重定向状态码

**文件**: `electron/sseClient.cjs`

```javascript
if (res.statusCode !== 200) {
  this.emit(id, 'error', ...);
  return;
}

```

当 SSE 端点返回 301/302 重定向时，直接报错。但 SSE 应该跟随重定向。 **影响**: 有 CDN/负载均衡重定向的 SSE 端点无法连接。 **修复**: 检查 3xx + Location 并递归重连（限制最大跳数）。

---

### BUG-12: H2 请求 `sslVerify=false` 参数取反

**文件**: `electron/httpClient.cjs`

```javascript
client = http2.connect(urlObj.origin, { rejectUnauthorized: sslVerify !== false });

```

当用户设置 `sslVerify = false`（关闭证书验证），`sslVerify !== false` → `false`，正确。 但当 `sslVerify = true`（默认），`true !== false` → `true`，正确。 ✅ 逻辑无误。但 `doSingleRequest` 中：

```javascript
if (isHttps) options.rejectUnauthorized = sslVerify;

```

这里直接赋布尔值，一致。OK — 此条为误报，取消。

---

## 💡 潜在问题（不一定是 Bug 但容易踩坑）

### BUG-13: HTTP 重定向未检查目标 URL scheme

**文件**: `electron/httpClient.cjs`

```javascript
curUrl = new URL(res.headers.location, curUrl);

```

如果服务器返回 `Location: file:///etc/passwd`，`new URL` 不会报错，后续 `doSingleRequest` 可能尝试通过 file 协议连接。 **影响**: 安全风险（理论上 node http/https 模块不支持 file 协议会抛错，但应主动拦截）。 **修复**: 验证 `curUrl.protocol` 为 `http:` 或 `https:`。

---

### BUG-14: `renderTemplate` 不支持嵌套 body 路径中的数组索引

**文件**: `electron/mockRender.cjs`

```javascript
const value = keyPath.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), root);

```

`{{body.items.0.name}}` 会尝试 `body.items["0"]` — 对数组实际可行。但 `{{body.items[0].name}}` 不支持（方括号语法）。 **影响**: 用户可能期望标准 JSONPath 语法但不生效 → 模板输出空串。 **修复**: 文档说明仅支持点语法；或添加简单的 `[n]` 解析。

---

### BUG-15: `runCollection` 中 envSet 跨请求传递但不跨迭代

**文件**: `src/utils/runnerUtil.js`

```javascript
for (let iter = 0; iter < totalIterations; iter += 1) {
  let iterVarMap = { ...ctx.varMap, ...rowVars }; // ← 每次迭代重置基础 varMap

```

如果用户期望迭代 1 的脚本 env.set 传递到迭代 2（链式令牌刷新场景），当前行为不支持。 **影响**: 依赖跨迭代变量传递的 Runner 脚本不生效。 **修复**: 提供可选配置 `persistEnvAcrossIterations`。

---

## 📋 汇总

| 严重程度 | 编号 | 模块 | 简述 |
| --- | --- | --- | --- |
| 🚨 严重 | BUG-01 | httpClient | H2 重定向链中连接泄漏 |
| 🚨 严重 | BUG-02 | mockServer | start() 未 await stop() 导致端口竞态 |
| 🚨 严重 | BUG-03 | runnerUtil | collectRunnableRequests 读取不存在的字段 |
| 🚨 严重 | BUG-04 | requestPipeline | `in` 运算符对数组无效导致变量删除错误 |
| 🚨 严重 | BUG-05 | CodeEditor | 搜索滚动 API 调用错误 ✅ 已修复 |
| ⚠️ 中等 | BUG-06 | httpClient | 代理模式 DNS 耗时显示异常 |
| ⚠️ 中等 | BUG-07 | mockServer | 路径匹配边界条件 |
| ⚠️ 中等 | BUG-08 | cookieUtil | max-age 优先级未遵循 RFC |
| ⚠️ 中等 | BUG-09 | urlSync | `%` 字符未编码 |
| ⚠️ 中等 | BUG-10 | mockScript | vm 沙箱 JSON 对象可被污染 |
| ⚠️ 中等 | BUG-11 | sseClient | 不跟随 HTTP 重定向 |
| 💡 潜在 | BUG-13 | httpClient | 重定向未校验目标协议 |
| 💡 潜在 | BUG-14 | mockRender | 模板不支持数组索引语法 |
| 💡 潜在 | BUG-15 | runnerUtil | env 不跨迭代传递 |

---

## 🔧 建议修复优先级

1. **立即修复**: BUG-03（Runner 完全不工作）、BUG-04（变量管理逻辑错误）、BUG-02（端口竞态）
2. **尽快修复**: BUG-01（内存泄漏）、BUG-10（安全）、BUG-08（Cookie 标准合规）
3. **计划修复**: BUG-09、BUG-11、BUG-13、BUG-06
4. **评估**: BUG-07、BUG-14、BUG-15（可通过文档说明规避）

