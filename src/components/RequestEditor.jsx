import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import KeyValueEditor from './KeyValueEditor.jsx';
import VarInput from './VarInput.jsx';
import CodeEditor from './CodeEditor.jsx';
import { syncParamsFromUrl, buildUrlFromParams, parseFormBody, buildFormBody } from '../utils/urlSync.js';
import { AUTH_TYPES, newAuth } from '../utils/authUtil.js';
import { COMMON_HEADERS } from '../utils/headerNames.js';
import { tabIn } from '../utils/motionPresets.js';
import { INTROSPECTION_QUERY, parseIntrospection, buildOperationSkeleton, buildVariablesSkeleton } from '../utils/graphqlUtil.js';
import { resolveVars } from '../utils/envUtil.js';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
/** 页签顺序：切换时据目标位置决定抽拉方向（Body 紧随 Params，高频页签前置） */
const TAB_ORDER = ['params', 'body', 'headers', 'auth', 'script', 'settings', 'doc'];

/**
 * 请求顶栏（全宽）：方法 + URL + 发送，独立于下方分栏区，保证 URL 完整可见
 * （保存移入标题行，cURL/代码移入右侧工具条）
 */
export function RequestBar({ request, sending, varNames = [], varMap = null, onChange, onSend, onCancel }) {
  /** URL 编辑 → 自动解析 query 到 Params 表 */
  const setUrl = (url) => {
    onChange({ ...request, url, params: syncParamsFromUrl(url, request.params) });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !sending) {
      onSend();
    }
  };

  return (
    <div className="request-bar">
      <input
        className={`method-select method-input method-${request.method}`}
        list="method-list"
        value={request.method}
        title="选择或输入自定义方法"
        onChange={(e) => onChange({ ...request, method: e.target.value.toUpperCase().replace(/[^A-Z-]/g, '') })}
        spellCheck={false}
      />
      <datalist id="method-list">
        {METHODS.map((m) => <option key={m} value={m} />)}
      </datalist>
      <VarInput
        className="url-input"
        placeholder="http://localhost:8080/api/..."
        value={request.url}
        varNames={varNames}
        varMap={varMap}
        highlight
        onChange={setUrl}
        onKeyDown={handleKeyDown}
      />
      {sending ? (
        <button className="btn-primary btn-cancel" title="取消发送中的请求" onClick={onCancel}>取消</button>
      ) : (
        <button className="btn-primary" onClick={onSend}>发送</button>
      )}
    </div>
  );
}

/**
 * 请求编辑器（顶栏已拆到 RequestBar）：Params / Body / Headers / 授权 / 脚本 / 设置 / 文档 页签
 * URL 中的 query 与 Params 表格双向自动同步；form 类型 Body 以键值表格编辑；
 * multipart 支持文件上传；值输入支持 {{变量}} 自动补全
 */
export default function RequestEditor({ request, varNames = [], varMap = {}, ownerCollection = null, onChange }) {
  // 当前活动页签
  const [tab, setTab] = useState('params');
  const [fmtError, setFmtError] = useState('');
  // 外部编辑中的脚本 token → 字段名映射（pre/post）
  const [extEditing, setExtEditing] = useState({});
  const requestRef = useRef(request);
  requestRef.current = request;
  const extEditingRef = useRef(extEditing);
  extEditingRef.current = extEditing;

  const set = (field, value) => onChange({ ...request, [field]: value });

  // 监听外部编辑器保存回传，写回对应脚本字段
  useEffect(() => {
    const unsubscribe = window.api.onScriptChanged(({ token, content }) => {
      const field = extEditingRef.current[token];
      if (field) onChange({ ...requestRef.current, [field]: content });
    });
    return () => {
      unsubscribe();
      // 关闭页面时停止对应监听
      Object.keys(extEditingRef.current).forEach((token) => window.api.closeScriptExternal(token));
    };
  }, []);

  /** 用外部编辑器（VSCode）打开脚本，保存后自动回写 */
  const openExternal = async (field) => {
    const res = await window.api.openScriptExternal({
      name: `${request.name || 'script'}-${field}`,
      content: request[field] || ''
    });
    if (res.ok) setExtEditing((prev) => ({ ...prev, [res.token]: field }));
  };

  const auth = request.auth || newAuth();
  const setAuth = (patch) => set('auth', { ...auth, ...patch });

  /** Params 表编辑 → 自动回写 URL 的 query 部分 */
  const setParams = (rows) => {
    onChange({ ...request, params: rows, url: buildUrlFromParams(request.url, rows) });
  };

  /** form Body 键值表编辑 → 同步序列化 body 字符串 */
  const setFormRows = (rows) => {
    onChange({ ...request, formData: rows, body: buildFormBody(rows) });
  };

  /** JSON Body 一键格式化 */
  const handleFormatJson = () => {
    try {
      set('body', JSON.stringify(JSON.parse(request.body), null, 2));
      setFmtError('');
    } catch (e) {
      setFmtError(e.message);
    }
  };

  const settingsCount = (request.proxy ? 1 : 0) + (request.followRedirects === false ? 1 : 0) +
    (request.timeoutMs && request.timeoutMs !== 30000 ? 1 : 0) +
    (request.httpVersion && request.httpVersion !== 'auto' ? 1 : 0) +
    (request.sslVerify === false ? 1 : 0) + (request.omitEmptyEq ? 1 : 0) +
    (request.cookieJarMode && request.cookieJarMode !== 'default' ? 1 : 0) +
    (request.injectId ? 1 : 0);

  // 发送时自动生成的锁定 Headers 预览（Host / Content-Type / Content-Length / ReqMock-Id）
  const manualKeys = new Set(
    (request.headers || []).filter((h) => h.enabled !== false && h.key).map((h) => h.key.toLowerCase())
  );
  const autoHeaders = [];
  try {
    autoHeaders.push({ key: 'Host', value: new URL(request.url).host, hint: '锁定：发送时按目标地址自动生成' });
  } catch (e) { /* URL 未填写完整时不展示 */ }
  if (request.bodyType !== 'none' && !['GET', 'HEAD'].includes(request.method)) {
    if (!manualKeys.has('content-type')) {
      const ct = request.bodyType === 'json' ? 'application/json'
        : request.bodyType === 'form' ? 'application/x-www-form-urlencoded'
        : request.bodyType === 'graphql' ? 'application/json'
        : request.bodyType === 'multipart' ? 'multipart/form-data; boundary=…' : '';
      if (ct) autoHeaders.push({ key: 'Content-Type', value: ct, hint: '锁定：按 Body 类型自动生成，手动填写同名 Header 时以手动值为准' });
    }
    autoHeaders.push({ key: 'Content-Length', value: '', hint: '锁定：发送时按请求体自动计算' });
  }
  if (request.injectId) autoHeaders.push({ key: 'ReqMock-Id', value: '', hint: '锁定：发送时自动生成 UUID' });

  // 集合继承预览：公共 Headers（请求内同名优先，与发送管线逻辑一致）+ 无授权时继承的集合授权
  const inheritedHeaders = ownerCollection
    ? (ownerCollection.headers || []).filter(
        (h) => h.enabled !== false && h.key && !manualKeys.has(h.key.toLowerCase())
      )
    : [];
  const inheritedAuth = ownerCollection && ownerCollection.auth &&
    ownerCollection.auth.type !== 'none' && auth.type === 'none' ? ownerCollection.auth : null;

  // 锁定行合并：集合继承的公共 Headers（⏬）+ 自动生成（🔒），内联置顶展示在请求头表格中
  const lockedHeaderRows = [
    ...inheritedHeaders.map((h) => ({
      key: h.key,
      value: resolveVars(h.value, varMap),
      mark: '⬇',
      hint: `继承自集合「${ownerCollection.name}」的公共 Headers，请求内同名 Header 优先`
    })),
    ...autoHeaders
  ];

  return (
    <div className="request-editor">
      <div className="editor-tabs">
        {[
          ['params', `Params${request.params.filter(p => p.key).length > 0 ? ` (${request.params.filter(p => p.key).length})` : ''}`],
          ['body', `Body${request.bodyType !== 'none' ? ' ●' : ''}`],
          ['headers', `Headers${request.headers.filter(h => h.key).length > 0 ? ` (${request.headers.filter(h => h.key).length})` : ''}`],
          ['auth', `授权${auth.type !== 'none' ? ' ●' : ''}`],
          ['script', `脚本${(request.preScript || request.postScript) ? ' ●' : ''}`],
          ['settings', `设置${settingsCount > 0 ? ' ●' : ''}`],
          ['doc', `文档${request.doc ? ' ●' : ''}`]
        ].map(([key, label]) => (
          <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {label}
            {tab === key && <motion.span className="tab-indicator" layoutId="req-tab-indicator" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          </button>
        ))}
      </div>

      <div className="editor-content">
        <motion.div className="editor-pane" key={tab} {...tabIn}>
        {tab === 'params' && (
          <KeyValueEditor
            rows={request.params}
            onChange={setParams}
            keyPlaceholder="参数名"
            valuePlaceholder="参数值"
            varNames={varNames}
            varMap={varMap}
            label="参数列表"
          />
        )}
        {tab === 'headers' && (
          <KeyValueEditor
            rows={request.headers}
            onChange={(rows) => set('headers', rows)}
            keyPlaceholder="请求头"
            valuePlaceholder="值"
            keySuggestions={COMMON_HEADERS}
            varNames={varNames}
            varMap={varMap}
            label="请求头列表"
            lockedRows={lockedHeaderRows}
          />
        )}
        {tab === 'auth' && (
          <div className="auth-editor">
            <div className="auth-row">
              <span className="auth-label">授权类型</span>
              <select
                className="auth-type-select"
                value={auth.type}
                onChange={(e) => setAuth({ type: e.target.value })}
              >
                {AUTH_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            {auth.type === 'none' && (
              inheritedAuth ? (
                <div className="env-hint">
                  将继承集合「{ownerCollection.name}」的授权：
                  {AUTH_TYPES.find((t) => t.value === inheritedAuth.type)?.label || inheritedAuth.type}（请求自身配置授权后优先生效）
                </div>
              ) : (
                <div className="empty-hint">不附加授权信息（若所属集合配置了授权将自动继承）</div>
              )
            )}
            {auth.type === 'basic' && (
              <>
                <div className="auth-row">
                  <span className="auth-label">用户名</span>
                  <input className="auth-input" value={auth.username} onChange={(e) => setAuth({ username: e.target.value })} />
                </div>
                <div className="auth-row">
                  <span className="auth-label">密码</span>
                  <input className="auth-input" type="password" value={auth.password} onChange={(e) => setAuth({ password: e.target.value })} />
                </div>
              </>
            )}
            {auth.type === 'bearer' && (
              <div className="auth-row">
                <span className="auth-label">Token</span>
                <VarInput className="auth-input" value={auth.token} varNames={varNames} varMap={varMap} onChange={(v) => setAuth({ token: v })} placeholder="支持 {{变量}}" />
              </div>
            )}
            {auth.type === 'apikey' && (
              <>
                <div className="auth-row">
                  <span className="auth-label">Key</span>
                  <input className="auth-input" value={auth.key} onChange={(e) => setAuth({ key: e.target.value })} placeholder="如 X-Api-Key" />
                </div>
                <div className="auth-row">
                  <span className="auth-label">Value</span>
                  <VarInput className="auth-input" value={auth.value} varNames={varNames} varMap={varMap} onChange={(v) => setAuth({ value: v })} placeholder="支持 {{变量}}" />
                </div>
                <div className="auth-row">
                  <span className="auth-label">添加到</span>
                  <select className="auth-type-select" value={auth.addTo} onChange={(e) => setAuth({ addTo: e.target.value })}>
                    <option value="header">Header</option>
                    <option value="query">Query 参数</option>
                  </select>
                </div>
              </>
            )}
            {auth.type !== 'none' && (
              <div className="env-hint">
                发送时自动生成对应的 Header / Query 参数；若已手动填写同名 Header 则以手动值为准，各字段支持 <code>{'{{变量}}'}</code>
              </div>
            )}
          </div>
        )}
        {tab === 'body' && (
          <div className="body-editor">
            <div className="body-type-bar">
              {['none', 'json', 'text', 'form', 'multipart', 'graphql'].map((t) => (
                <label key={t}>
                  <input
                    type="radio"
                    name="bodyType"
                    checked={request.bodyType === t}
                    onChange={() => set('bodyType', t)}
                  />
                  {t}
                </label>
              ))}
              {request.bodyType === 'json' && (
                <>
                  <span className="flex-spacer" />
                  <button className="btn-text" title="格式化 JSON" onClick={handleFormatJson}>格式化</button>
                </>
              )}
            </div>
            {fmtError && request.bodyType === 'json' && (
              <div className="script-error">JSON 格式错误：{fmtError}</div>
            )}
            {request.bodyType === 'form' && (
              <KeyValueEditor
                rows={request.formData?.length ? request.formData : parseFormBody(request.body)}
                onChange={setFormRows}
                keyPlaceholder="字段名"
                valuePlaceholder="字段值"
                varNames={varNames}
                varMap={varMap}
                label="表单字段"
              />
            )}
            {request.bodyType === 'multipart' && (
              <MultipartEditor
                rows={request.formData || []}
                onChange={(rows) => set('formData', rows)}
              />
            )}
            {request.bodyType === 'graphql' && (
              <GraphqlEditor request={request} varMap={varMap} onChange={onChange} />
            )}
            {request.bodyType !== 'none' && request.bodyType !== 'form' && request.bodyType !== 'multipart' && request.bodyType !== 'graphql' && (
              <CodeEditor
                className="body-code"
                language={request.bodyType === 'json' ? 'json' : 'text'}
                placeholder={request.bodyType === 'json' ? '{ "key": "value" }' : '原始文本'}
                value={request.body}
                onChange={(v) => { set('body', v); setFmtError(''); }}
              />
            )}
          </div>
        )}
        {tab === 'script' && (
          <div className="script-editor">
            <div className="script-col">
              <div className="script-title">
                前置脚本（发送前执行，可修改 rm.request / 写环境变量）
                <button className="btn-text script-ext-btn" title="写入临时文件并用 VSCode 打开，保存后自动同步回此处" onClick={() => openExternal('preScript')}>
                  {Object.values(extEditing).includes('preScript') ? '● 外部编辑中' : 'VSCode 编辑'}
                </button>
              </div>
              <CodeEditor
                className="script-code"
                language="javascript"
                placeholder={'// 示例：\n// rm.env.set("token", "abc123");\n// rm.request.headers.push({ key: "X-Trace", value: rm.env.get("token"), enabled: true });'}
                value={request.preScript || ''}
                onChange={(v) => set('preScript', v)}
              />
            </div>
            <div className="script-col">
              <div className="script-title">
                后置脚本（响应后执行，可断言测试 / 提取变量）
                <button className="btn-text script-ext-btn" title="写入临时文件并用 VSCode 打开，保存后自动同步回此处" onClick={() => openExternal('postScript')}>
                  {Object.values(extEditing).includes('postScript') ? '● 外部编辑中' : 'VSCode 编辑'}
                </button>
              </div>
              <CodeEditor
                className="script-code"
                language="javascript"
                placeholder={'// 示例：\nrm.test("状态码为200", () => rm.assert(rm.response.status === 200));\n// rm.env.set("uid", rm.response.json().data.id);'}
                value={request.postScript || ''}
                onChange={(v) => set('postScript', v)}
              />
            </div>
          </div>
        )}
        {tab === 'settings' && (
          <div className="auth-editor">
            <div className="auth-row">
              <span className="auth-label">HTTP 版本</span>
              <select
                className="auth-type-select"
                value={request.httpVersion || 'auto'}
                onChange={(e) => set('httpVersion', e.target.value)}
              >
                <option value="auto">HTTP/1.1（默认）</option>
                <option value="h2">HTTP/2（仅 https 直连，走代理时回退 1.1）</option>
              </select>
            </div>
            <div className="auth-row">
              <span className="auth-label">HTTP 代理</span>
              <input
                className="auth-input"
                placeholder="http://127.0.0.1:8888（留空不使用代理）"
                value={request.proxy || ''}
                onChange={(e) => set('proxy', e.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="auth-row">
              <span className="auth-label">超时（ms）</span>
              <input
                className="auth-input num-input"
                type="number"
                min={1000}
                step={1000}
                value={request.timeoutMs || 30000}
                onChange={(e) => set('timeoutMs', Math.max(1000, Number(e.target.value) || 30000))}
              />
            </div>
            <div className="auth-row">
              <span className="auth-label">跟随重定向</span>
              <label className="inline-label">
                <input
                  type="checkbox"
                  checked={request.followRedirects !== false}
                  onChange={(e) => set('followRedirects', e.target.checked)}
                />
                自动跟随 3xx 重定向（最多 10 次）
              </label>
            </div>
            <div className="auth-row">
              <span className="auth-label">SSL 证书校验</span>
              <label className="inline-label">
                <input
                  type="checkbox"
                  checked={request.sslVerify !== false}
                  onChange={(e) => set('sslVerify', e.target.checked)}
                />
                校验服务器证书（调试自签证书时可关闭）
              </label>
            </div>
            <div className="auth-row">
              <span className="auth-label">空值参数</span>
              <label className="inline-label">
                <input
                  type="checkbox"
                  checked={!!request.omitEmptyEq}
                  onChange={(e) => set('omitEmptyEq', e.target.checked)}
                />
                省略等号（a= → a）
              </label>
            </div>
            <div className="auth-row">
              <span className="auth-label">Cookie Jar</span>
              <select
                className="auth-type-select"
                value={request.cookieJarMode || 'default'}
                onChange={(e) => set('cookieJarMode', e.target.value)}
              >
                <option value="default">跟随全局设置</option>
                <option value="on">强制启用（自动附加/记录 Cookie）</option>
                <option value="off">强制禁用</option>
              </select>
            </div>
            <div className="auth-row">
              <span className="auth-label">ReqMock-Id</span>
              <label className="inline-label">
                <input
                  type="checkbox"
                  checked={!!request.injectId}
                  onChange={(e) => set('injectId', e.target.checked)}
                />
                发送时自动注入 ReqMock-Id 请求头（UUID，便于服务端链路追踪）
              </label>
            </div>
            <div className="env-hint">
              以上设置仅对当前请求生效；代理支持 <code>http://user:pass@host:port</code> 形式的认证
            </div>
          </div>
        )}
        {tab === 'doc' && (
          <textarea
            className="body-textarea doc-textarea"
            placeholder="请求说明文档（接口用途、参数含义、注意事项…）"
            value={request.doc || ''}
            onChange={(e) => set('doc', e.target.value)}
            spellCheck={false}
          />
        )}
        </motion.div>
      </div>
    </div>
  );
}

/**
 * GraphQL Body 编辑器：Query + Variables 双栏，支持拉取 introspection 展示操作列表并插入骨架
 */
function GraphqlEditor({ request, varMap, onChange }) {
  const [ops, setOps] = useState(null);
  const [loading, setLoading] = useState(false);
  const [schemaError, setSchemaError] = useState('');
  const gq = request.graphql || { query: '', variables: '' };
  const setGq = (patch) => onChange({ ...request, graphql: { ...gq, ...patch } });

  /** 向当前 URL 发 introspection POST（复用主进程管线，URL/Headers 先做变量替换） */
  const fetchSchema = async () => {
    setLoading(true);
    setSchemaError('');
    try {
      const url = resolveVars(request.url, varMap);
      const headers = (request.headers || [])
        .filter((h) => h.enabled !== false && h.key)
        .map((h) => ({ key: resolveVars(h.key, varMap), value: resolveVars(h.value, varMap), enabled: true }));
      const res = await window.api.sendRequest({
        method: 'POST', url, headers,
        bodyType: 'json', body: JSON.stringify({ query: INTROSPECTION_QUERY }),
        timeoutMs: 15000
      });
      if (!res.ok) throw new Error(res.error || '请求失败');
      if (res.status >= 400) throw new Error(`HTTP ${res.status} ${res.statusText || ''}`);
      setOps(parseIntrospection(res.body));
    } catch (e) {
      setSchemaError(e.message);
      setOps(null);
    }
    setLoading(false);
  };

  /** 点击操作 → 生成 Query 骨架 + Variables 占位写入编辑器 */
  const insertOp = (op) => {
    onChange({ ...request, graphql: { ...gq, query: buildOperationSkeleton(op), variables: buildVariablesSkeleton(op) } });
  };

  return (
    <div className="gql-editor">
      <div className="gql-toolbar">
        <button className="btn-text" disabled={loading} onClick={fetchSchema}>
          {loading ? '拉取中…' : '拉取 Schema'}
        </button>
        <span className="env-hint">向当前 URL 发送 introspection 查询，列出 Query / Mutation 操作</span>
      </div>
      {schemaError && <div className="script-error">拉取 Schema 失败：{schemaError}</div>}
      {ops && (
        <div className="gql-ops">
          {ops.length === 0 && <div className="empty-hint">Schema 中没有 Query / Mutation 操作</div>}
          {ops.map((op) => (
            <div
              key={`${op.kind}:${op.name}`}
              className="gql-op-item"
              title={`${op.description ? op.description + '\n' : ''}点击插入操作骨架（会覆盖当前 Query）`}
              onClick={() => insertOp(op)}
            >
              <span className={`gql-op-kind gql-op-${op.kind}`}>{op.kind === 'mutation' ? 'M' : 'Q'}</span>
              <span className="gql-op-name">{op.name}</span>
              <span className="gql-op-sig">
                {op.args.length > 0 && `(${op.args.map((a) => `${a.name}: ${a.type}`).join(', ')})`}
                {op.returnType && ` → ${op.returnType}`}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="gql-cols">
        <div className="gql-col">
          <div className="script-title">Query</div>
          <CodeEditor
            className="gql-code"
            language="text"
            placeholder={'query Demo($id: ID!) {\n  user(id: $id) {\n    name\n  }\n}'}
            value={gq.query}
            onChange={(v) => setGq({ query: v })}
          />
        </div>
        <div className="gql-col gql-col-vars">
          <div className="script-title">Variables（JSON）</div>
          <CodeEditor
            className="gql-code"
            language="json"
            placeholder={'{\n  "id": "1"\n}'}
            value={gq.variables}
            onChange={(v) => setGq({ variables: v })}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * multipart 表单编辑器：每行可选 文本/文件 类型，文件行通过系统对话框选择路径
 */
function MultipartEditor({ rows, onChange }) {
  const update = (index, patch) => {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const pickFile = async (index) => {
    const res = await window.api.pickFile();
    if (res.ok) {
      update(index, { type: 'file', filePath: res.filePath, value: res.name });
    }
  };

  return (
    <div className="kv-editor">
      {rows.map((row, i) => (
        <div key={i} className="kv-row">
          <input
            type="checkbox"
            checked={row.enabled !== false}
            onChange={(e) => update(i, { enabled: e.target.checked })}
          />
          <input
            className="kv-key"
            placeholder="字段名"
            value={row.key}
            onChange={(e) => update(i, { key: e.target.value })}
          />
          <select
            className="mp-type-select"
            value={row.type === 'file' ? 'file' : 'text'}
            onChange={(e) => update(i, { type: e.target.value, filePath: '', value: '' })}
          >
            <option value="text">文本</option>
            <option value="file">文件</option>
          </select>
          {row.type === 'file' ? (
            <button className="btn-secondary mp-file-btn" title={row.filePath || '选择文件'} onClick={() => pickFile(i)}>
              {row.filePath ? `📄 ${row.value || row.filePath}` : '选择文件…'}
            </button>
          ) : (
            <input
              className="kv-value"
              placeholder="字段值"
              value={row.value}
              onChange={(e) => update(i, { value: e.target.value })}
            />
          )}
          <span className="item-delete" onClick={() => onChange(rows.filter((r, idx) => idx !== i))}>×</span>
        </div>
      ))}
      <button className="btn-text" onClick={() => onChange([...rows, { key: '', value: '', type: 'text', filePath: '', enabled: true }])}>
        + 添加字段
      </button>
    </div>
  );
}
