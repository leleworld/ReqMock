import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { JbIcon } from './Icons.jsx';
import KeyValueEditor from './KeyValueEditor.jsx';
import VarInput from './VarInput.jsx';
import CodeEditor from './CodeEditor.jsx';
import { syncParamsFromUrl, buildUrlFromParams, parseFormBody, buildFormBody } from '../utils/urlSync.js';
import { AUTH_TYPES, newAuth, previewAuthHeader } from '../utils/authUtil.js';
import { parseCurl } from '../utils/curlUtil.js';
import { renderMarkdown } from '../utils/markdownUtil.js';
import { COMMON_HEADERS } from '../utils/headerNames.js';
import { INTROSPECTION_QUERY, parseIntrospection, buildOperationSkeleton, buildVariablesSkeleton } from '../utils/graphqlUtil.js';
import { resolveVars } from '../utils/envUtil.js';
import { applyPresetToHeaders } from '../utils/headerPresets.js';
import { applyPresetToParams } from '../utils/paramPresets.js';

import { HeaderPresetsModal } from './Modals.jsx';
import { ParamPresetsModal } from './Modals.jsx';

const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
/** 页签顺序：切换时据目标位置决定抽拉方向（Body 紧随 Params，高频页签前置） */
const TAB_ORDER = ['params', 'body', 'headers', 'auth', 'script', 'settings', 'doc', 'examples'];
/** 页签行常驻显示的高频三项；其余收进右侧「更多页签」下拉，宽度不足时连常驻项也只留当前页签 */
const PINNED_TABS = ['params', 'body', 'headers'];

/**
 * 脚本片段插入浮层：按分类展示模板，选中后插入代码到目标字段
 */
function ScriptSnippetPopover({ onInsert }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const popoverRef = useRef(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handleClick = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target) &&
          btnRef.current && !btnRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="script-snippet-wrapper">
      <button
        ref={btnRef}
        className="script-snippet-btn"
        title="插入脚本模板片段"
        onClick={() => setOpen(!open)}
      >
        插入片段
      </button>
      {open && (
        <div className="snippet-popover" ref={popoverRef}>
          {SCRIPT_TEMPLATES.map((cat) => (
            <div key={cat.category} className="snippet-category">
              <div className="snippet-category-title">{cat.category}</div>
              {cat.templates.map((tpl) => (
                <div key={tpl.name} className="snippet-item" onClick={() => { onInsert(tpl.code); setOpen(false); }}>
                  {tpl.name}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 请求顶栏（全宽）：方法 + URL + 发送，独立于下方分栏区，保证 URL 完整可见
 * （保存移入标题行，cURL/代码移入右侧工具条）
 */
export function RequestBar({ request, sending, varNames = [], varMap = null, activeEnv = null, urlHistory = [], onChange, onSend, onCancel, onToast }) {
  const [methodOpen, setMethodOpen] = useState(false);

  useEffect(() => {
    if (!methodOpen) return;
    const close = () => setMethodOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [methodOpen]);

  /** URL 编辑 → 自动解析 query 到 Params 表 */
  const setUrl = (url) => {
    onChange({ ...request, url, params: syncParamsFromUrl(url, request.params) });
  };

  // ---- URL 历史自动补全 ----
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [sugIndex, setSugIndex] = useState(-1);
  // 完整 URL 展开面板：长 URL 在单行输入框里被裁尾，Alt+Enter 或点「全文」展开多行查看
  const [urlExpanded, setUrlExpanded] = useState(false);
  const sugTimeoutRef = useRef(null);

  const filterSuggestions = (input) => {
    if (!input || !urlHistory.length) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const lower = input.toLowerCase();
    const matches = urlHistory.filter((h) => h.url.toLowerCase().includes(lower)).slice(0, 8);
    setSuggestions(matches);
    setShowSuggestions(matches.length > 0);
    setSugIndex(-1);
  };

  const handleUrlChange = (url) => {
    setUrl(url);
    filterSuggestions(url);
  };

  const handleSelectSuggestion = (item) => {
    onChange({ ...request, url: item.url, method: item.method, params: syncParamsFromUrl(item.url, request.params) });
    setShowSuggestions(false);
    setSuggestions([]);
  };

  const handleUrlBlur = () => {
    sugTimeoutRef.current = setTimeout(() => {
      setShowSuggestions(false);
    }, 150);
  };

  const handleUrlFocus = () => {
    if (sugTimeoutRef.current) clearTimeout(sugTimeoutRef.current);
    if (request.url) filterSuggestions(request.url);
  };

  const handleKeyDown = (e) => {
    // Alt+Enter：展开/收起完整 URL（优先于补全导航处理）
    if (e.key === 'Enter' && e.altKey) {
      e.preventDefault();
      setUrlExpanded((v) => !v);
      return;
    }
    // URL suggestions 键盘导航
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSugIndex((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSugIndex((prev) => (prev <= 0 ? suggestions.length - 1 : prev - 1));
        return;
      }
      if (e.key === 'Enter' && sugIndex >= 0) {
        e.preventDefault();
        handleSelectSuggestion(suggestions[sugIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
        return;
      }
    }
    if (e.key === 'Enter' && !sending) {
      onSend();
    }
  };

  /** 粘贴 cURL 命令自动识别导入（覆盖方法/URL/Headers/Body/授权） */
  const handlePaste = (e) => {
    const text = (e.clipboardData && e.clipboardData.getData('text')) || '';
    if (!/^\s*(\$\s*)?curl(\.exe)?\s/i.test(text)) return;
    e.preventDefault();
    try {
      const parsed = parseCurl(text);
      onChange({
        ...request,
        method: parsed.method,
        url: parsed.url,
        params: syncParamsFromUrl(parsed.url, []),
        headers: parsed.headers,
        bodyType: parsed.bodyType,
        body: parsed.body,
        auth: parsed.auth ? { ...newAuth(), ...parsed.auth } : request.auth
      });
      if (onToast) onToast('已识别 cURL 命令并填充请求', 'success');
    } catch (err) {
      if (onToast) onToast('cURL 解析失败：' + err.message, 'error');
    }
  };

  // 激活环境设了颜色时，请求栏左侧展示环境警示色条，避免发错环境
  const envColor = activeEnv && activeEnv.color ? activeEnv.color : null;

  // 完整 URL 展开面板数据：按 ? 与 & 断行，长 URL 一眼看全并可整段复制
  const rawUrl = request.url || '';
  const urlQIdx = rawUrl.indexOf('?');
  const urlBase = urlQIdx >= 0 ? rawUrl.slice(0, urlQIdx) : rawUrl;
  const urlPairs = urlQIdx >= 0 ? rawUrl.slice(urlQIdx + 1).split('&').filter(Boolean) : [];
  // 仅当 URL 长到单行大概率看不全时才占位，短 URL 不加噪声、不挤输入框
  const showUrlToggle = rawUrl.length > 80;

  return (
    <>
    <div
      className={`request-bar${envColor ? ' env-tinted' : ''}`}
      style={envColor ? { '--env-accent': envColor } : undefined}
      title={envColor ? `当前环境：${activeEnv.name}` : undefined}
    >
      <div className="method-dropdown" style={{ position: 'relative' }}>
        <button
          className={`method-select method-input method-${request.method}`}
          title="选择 HTTP 方法"
          onClick={() => setMethodOpen(!methodOpen)}
        >
          {request.method} <span className="method-caret">▾</span>
        </button>
        {methodOpen && (
          <div className="method-dropdown-menu" onMouseDown={(e) => e.stopPropagation()}>
            {METHODS.map((m) => (
              <div
                key={m}
                className={`method-dropdown-item method-${m} ${m === request.method ? 'active' : ''}`}
                onClick={() => { onChange({ ...request, method: m }); setMethodOpen(false); }}
              >{m}</div>
            ))}
          </div>
        )}
      </div>
      <div className="url-input-wrap">
        <VarInput
          className="url-input"
          placeholder="http://localhost:8080/api/...（可直接粘贴 cURL 命令）"
          value={request.url}
          title={request.url || undefined}
          varNames={varNames}
          varMap={varMap}
          highlight
          onChange={handleUrlChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBlur={handleUrlBlur}
          onFocus={handleUrlFocus}
        />
        {showSuggestions && suggestions.length > 0 && (
          <div className="url-suggestions">
            {suggestions.map((item, i) => (
              <div
                key={item.url}
                className={`url-suggestion-item${i === sugIndex ? ' active' : ''}`}
                onMouseDown={() => handleSelectSuggestion(item)}
              >
                <span className={`method method-${item.method}`}>{item.method}</span>
                <span className="url-suggestion-url">{item.url}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {showUrlToggle && (
        <button
          className="url-full-btn"
          title={urlExpanded ? '收起完整 URL (Alt+Enter)' : '展开查看完整 URL (Alt+Enter)'}
          onClick={() => setUrlExpanded((v) => !v)}
        >{urlExpanded ? '收起' : '全文'}</button>
      )}
      {sending ? (
        <button className="btn-primary btn-sending" title="请求发送中，点击取消" onClick={onCancel}>
          <span className="btn-ring" aria-hidden="true" />发送中
        </button>
      ) : (
        <button className="btn-primary" onClick={onSend}>发送</button>
      )}
    </div>
    {urlExpanded && (
      <div className="url-expanded">
        <div className="url-expanded-head">
          <span>完整 URL · {rawUrl.length} 字符 · {urlPairs.length} 个查询参数</span>
          <span className="flex-spacer" />
          <button
            className="btn-text"
            onClick={() => {
              if (navigator.clipboard) navigator.clipboard.writeText(rawUrl);
              if (onToast) onToast('已复制完整 URL', 'success');
            }}
          >复制</button>
          <button className="btn-text" onClick={() => setUrlExpanded(false)}>收起</button>
        </div>
        <pre className="url-expanded-body">{urlBase}{urlPairs.map((p, i) => `\n  ${i === 0 ? '?' : '&'} ${p}`)}</pre>
      </div>
    )}
    </>
  );
}

/**
 * 请求编辑器（顶栏已拆到 RequestBar）：Params / Body / Headers / 授权 / 脚本 / 设置 / 文档 页签
 * URL 中的 query 与 Params 表格双向自动同步；form 类型 Body 以键值表格编辑；
 * multipart 支持文件上传；值输入支持 {{变量}} 自动补全
 */
export default function RequestEditor({ request, varNames = [], varMap = {}, ownerCollection = null, onChange, onExampleToMock, headerPresets = [], onChangeHeaderPresets, paramPresets = [], onChangeParamPresets, fontSize, tabSize, wordWrap, showLineNumbers }) {
  // 当前活动页签
  const [tab, setTabRaw] = useState('params');
  const [tabDir, setTabDir] = useState(1); // 滑动方向：目标页签在右侧为 1，左侧为 -1
  const setTab = (key) => {
    setTabDir(TAB_ORDER.indexOf(key) >= TAB_ORDER.indexOf(tab) ? 1 : -1);
    setTabRaw(key);
  };

  // 切到另一个请求时按方法定焦子页签：GET → Params，POST → Body，其余方法保持用户当前所在页签。
  // 仅在「请求身份变化」时生效：同一请求内改方法不会抢走焦点。
  const focusReqIdRef = useRef(null);
  useEffect(() => {
    const id = request && request.id;
    if (!id || id === focusReqIdRef.current) return;
    focusReqIdRef.current = id;
    const m = (request.method || '').toUpperCase();
    if (m === 'GET') setTab('params');
    else if (m === 'POST') setTab('body');
  }, [request]);
  // ---- 页签可见性：常驻 Params/Body/Headers + 当前页签；其余收进「更多页签」下拉 ----
  // 不做窄宽度塌缩：窄容器由 .editor-tabs 既有的横向滚动兜底，三项始终可见可点
  // 「更多页签」下拉：{ top, left } | null
  const [tabsMenu, setTabsMenu] = useState(null);

  // 点击面板外或按 Esc 关闭「更多页签」下拉
  useEffect(() => {
    if (!tabsMenu) return undefined;
    const onDown = (e) => {
      if (e.target instanceof Element && e.target.closest('.editor-tabs-more-wrap')) return;
      setTabsMenu(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setTabsMenu(null); };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [tabsMenu]);

  const [fmtError, setFmtError] = useState('');
  const [docPreview, setDocPreview] = useState(false); // 文档页 Markdown 预览开关
  // Headers 预设：下拉菜单定位 + 管理弹窗开关
  const [presetMenu, setPresetMenu] = useState(null);
  const [presetMgrOpen, setPresetMgrOpen] = useState(false);
  // Params 预设：下拉菜单定位 + 管理弹窗开关
  const [paramPresetMenu, setParamPresetMenu] = useState(null);
  const [paramPresetMgrOpen, setParamPresetMgrOpen] = useState(false);
  // 外部编辑中的脚本 token → 字段名映射（pre/post）
  const [extEditing, setExtEditing] = useState({});
  // 当前活跃的脚本字段（用于插入片段时决定目标）
  const [activeScriptField, setActiveScriptField] = useState('preScript');
  const requestRef = useRef(request);
  requestRef.current = request;
  const extEditingRef = useRef(extEditing);
  extEditingRef.current = extEditing;

  const set = (field, value) => onChange({ ...request, [field]: value });

  // 点击菜单外区域关闭预设下拉
  useEffect(() => {
    if (!presetMenu) return;
    const close = () => setPresetMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [presetMenu]);
  useEffect(() => {
    if (!paramPresetMenu) return;
    const close = () => setParamPresetMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [paramPresetMenu]);

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

  // 授权头预览：请求自身授权优先，其次继承集合授权；字段先做变量替换再生成（与发送时一致）
  const effectiveAuth = auth.type !== 'none' ? auth : inheritedAuth;
  const authPreview = previewAuthHeader(effectiveAuth ? {
    ...effectiveAuth,
    username: resolveVars(effectiveAuth.username || '', varMap),
    password: resolveVars(effectiveAuth.password || '', varMap),
    token: resolveVars(effectiveAuth.token || '', varMap),
    value: resolveVars(effectiveAuth.value || '', varMap)
  } : null);
  const authRows = authPreview && !manualKeys.has(authPreview.key.toLowerCase())
    ? [{
        key: authPreview.key,
        value: authPreview.value,
        mark: effectiveAuth === inheritedAuth ? 'import' : 'lock',
        hint: effectiveAuth === inheritedAuth
          ? `继承自集合「${ownerCollection.name}」的授权，发送时自动附加`
          : '锁定：按「授权」页签配置自动生成，手动填写同名 Header 时以手动值为准'
      }]
    : [];

  // 锁定行合并：集合继承的公共 Headers（⏬）+ 授权头 + 自动生成（🔒），内联置顶展示在请求头表格中
  const lockedHeaderRows = [
    ...inheritedHeaders.map((h) => ({
      key: h.key,
      value: resolveVars(h.value, varMap),
      mark: 'import',
      hint: `继承自集合「${ownerCollection.name}」的公共 Headers，请求内同名 Header 优先`
    })),
    ...authRows,
    ...autoHeaders
  ];

  // Headers 工具栏「预设」按钮 + 下拉菜单（应用预设 / 管理预设）
  const presetsBtn = (
    <>
      <button
        className={`icon-btn kv-bulk-btn ${presetMenu ? 'on' : ''}`}
        title="应用 HTTP 请求头预设"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (presetMenu) { setPresetMenu(null); return; }
          const rect = e.currentTarget.getBoundingClientRect();
          setPresetMenu({ top: rect.bottom + 4, left: rect.left });
        }}
      >预设 <JbIcon name="caret-down" size={10} className="caret-icon" /></button>
      {presetMenu && (
        <div className="ctx-menu hp-menu" style={{ top: presetMenu.top, left: presetMenu.left }} onMouseDown={(e) => e.stopPropagation()}>
          {headerPresets.map((p) => (
            <div
              key={p.id}
              className="ctx-item"
              title={p.rows.map((r) => `${r.key}: ${r.value}`).join('\n')}
              onClick={() => { set('headers', applyPresetToHeaders(request.headers, p)); setPresetMenu(null); }}
            >
              {p.name}{p.builtIn ? <span className="hp-builtin-tag">内置</span> : null}
              <span className="ctx-kbd">{p.rows.length} 项</span>
            </div>
          ))}
          <div className="ctx-sep" />
          <div className="ctx-item" onClick={() => { setPresetMenu(null); setPresetMgrOpen(true); }}>管理预设…</div>
        </div>
      )}
    </>
  );

  // Params 工具栏「预设」按钮 + 下拉菜单
  const paramPresetsBtn = (
    <>
      <button
        className={`icon-btn kv-bulk-btn ${paramPresetMenu ? 'on' : ''}`}
        title="应用参数预设"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          if (paramPresetMenu) { setParamPresetMenu(null); return; }
          const rect = e.currentTarget.getBoundingClientRect();
          setParamPresetMenu({ top: rect.bottom + 4, left: rect.left });
        }}
      >预设 <JbIcon name="caret-down" size={10} className="caret-icon" /></button>
      {paramPresetMenu && (
        <div className="ctx-menu hp-menu" style={{ top: paramPresetMenu.top, left: paramPresetMenu.left }} onMouseDown={(e) => e.stopPropagation()}>
          {paramPresets.map((p) => (
            <div
              key={p.id}
              className="ctx-item"
              title={p.rows.map((r) => `${r.key}=${r.value}`).join('\n')}
              onClick={() => { setParams(applyPresetToParams(request.params, p)); setParamPresetMenu(null); }}
            >
              {p.name}{p.builtIn ? <span className="hp-builtin-tag">内置</span> : null}
              <span className="ctx-kbd">{p.rows.length} 项</span>
            </div>
          ))}
          <div className="ctx-sep" />
          <div className="ctx-item" onClick={() => { setParamPresetMenu(null); setParamPresetMgrOpen(true); }}>管理预设…</div>
        </div>
      )}
    </>
  );

  // ---- 页签可见性策略（对标 Postman）----
  // 常驻高频三项，其余收进右侧向下三角；容器再窄就塌缩成「只显示当前页签」
  const tabDefs = [
    ['params', 'Params', request.params.filter((p) => p.key).length, false, true],
    ['body', 'Body', 0, request.bodyType !== 'none', false],
    ['headers', 'Headers', request.headers.filter((h) => h.key).length, false, true],
    ['auth', '授权', 0, auth.type !== 'none', false],
    ['script', '脚本', 0, !!(request.preScript || request.postScript), false],
    ['settings', '设置', 0, settingsCount > 0, false],
    ['doc', '文档', 0, !!request.doc, false],
    ['examples', '示例', (request.examples || []).length, false, true]
  ];
  const activeDef = tabDefs.find((d) => d[0] === tab) || tabDefs[0];
  const pinnedDefs = tabDefs.filter((d) => PINNED_TABS.includes(d[0]));
  // 常驻三项恒显示；当前页签不在三项之中时内联追加显示（切换目标一眼可见）
  const shownDefs = PINNED_TABS.includes(tab) ? pinnedDefs : [...pinnedDefs, activeDef];

  const renderTabBtn = ([key, label, count, hasDot, hasCount]) => (
    <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
      {label}
      {hasCount && <span className={`tab-count${count ? '' : ' is-empty'}`}>({count})</span>}
      {hasDot && <span className="dot-indicator" />}
      {tab === key && <motion.span className="tab-indicator" layoutId="req-tab-indicator" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
    </button>
  );

  return (
    <div className="request-editor">
      <div className="editor-tabs">
        {shownDefs.map(renderTabBtn)}
        <span className="editor-tabs-more-wrap">
          <button
            className={`editor-tabs-more${tabsMenu ? ' on' : ''}`}
            title="选择要显示的页签"
            aria-label="更多页签"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setTabsMenu(tabsMenu ? null : { top: rect.bottom + 4, left: Math.min(rect.left, window.innerWidth - 180) });
            }}
          ><JbIcon name="caret-down" size={10} /></button>
          {tabsMenu && (
            <div className="ctx-menu hp-menu editor-tabs-menu" style={{ top: tabsMenu.top, left: tabsMenu.left }} onMouseDown={(e) => e.stopPropagation()}>
              {tabDefs.map(([key, label, count, , hasCount]) => (
                <div key={key} className="ctx-item" onClick={() => { setTab(key); setTabsMenu(null); }}>
                  <span className="ctx-check">{tab === key ? <JbIcon name="checkmark" size={12} /> : ''}</span>
                  <span className="ctx-label">{label}</span>
                  {hasCount && count > 0 && <span className="ctx-kbd">{count}</span>}
                </div>
              ))}
            </div>
          )}
        </span>
      </div>

      <div className="editor-content">
        <div className="editor-pane">
        {tab === 'params' && (
          <KeyValueEditor
            rows={request.params}
            onChange={setParams}
            keyPlaceholder="参数名"
            valuePlaceholder="参数值"
            varNames={varNames}
            varMap={varMap}
            label="参数列表"
            toolbarExtra={paramPresetsBtn}
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
            toolbarExtra={presetsBtn}
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
                fontSize={fontSize}
                tabSize={tabSize}
                wordWrap={wordWrap}
                showLineNumbers={showLineNumbers}
                placeholder={request.bodyType === 'json' ? '{ "key": "value" }' : '原始文本'}
                value={request.body}
                onChange={(v) => { set('body', v); setFmtError(''); }}
              />
            )}
          </div>
        )}
        {tab === 'script' && (
          <div className="script-editor">
            <div className="script-toolbar">
              <ScriptSnippetPopover onInsert={(code) => {
                const field = activeScriptField;
                const prev = request[field] || '';
                const newVal = prev ? prev + '\n' + code : code;
                set(field, newVal);
              }} />
              <span className="script-toolbar-hint">当前插入目标：{activeScriptField === 'preScript' ? '前置脚本' : '后置脚本'}</span>
            </div>
            <div className="script-editor-cols">
            <div className="script-col">
              <div className="script-title">
                前置脚本（发送前执行，可修改 rm.request / 写环境变量）
                <button className="btn-text script-ext-btn" title="写入临时文件并用 VSCode 打开，保存后自动同步回此处" onClick={() => openExternal('preScript')}>
                  {Object.values(extEditing).includes('preScript') ? <><span className="dot-indicator on" /> 外部编辑中</> : 'VSCode 编辑'}
                </button>
              </div>
              <CodeEditor
                className="script-code"
                language="javascript"
                fontSize={fontSize}
                tabSize={tabSize}
                wordWrap={wordWrap}
                showLineNumbers={showLineNumbers}
                placeholder={'// 示例：\n// rm.env.set("token", "abc123");\n// rm.request.headers.push({ key: "X-Trace", value: rm.env.get("token"), enabled: true });'}
                value={request.preScript || ''}
                onChange={(v) => set('preScript', v)}
                onFocus={() => setActiveScriptField('preScript')}
              />
            </div>
            <div className="script-col">
              <div className="script-title">
                后置脚本（响应后执行，可断言测试 / 提取变量）
                <button className="btn-text script-ext-btn" title="写入临时文件并用 VSCode 打开，保存后自动同步回此处" onClick={() => openExternal('postScript')}>
                  {Object.values(extEditing).includes('postScript') ? <><span className="dot-indicator on" /> 外部编辑中</> : 'VSCode 编辑'}
                </button>
              </div>
              <CodeEditor
                className="script-code"
                language="javascript"
                fontSize={fontSize}
                tabSize={tabSize}
                wordWrap={wordWrap}
                showLineNumbers={showLineNumbers}
                placeholder={'// 示例：\nrm.test("状态码为200", () => rm.assert(rm.response.status === 200));\n// rm.env.set("uid", rm.response.json().data.id);'}
                value={request.postScript || ''}
                onChange={(v) => set('postScript', v)}
                onFocus={() => setActiveScriptField('postScript')}
              />
            </div>
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
              <span className="auth-label">URL 编码</span>
              <label className="inline-label">
                <input
                  type="checkbox"
                  checked={request.encodeUrl !== false}
                  onChange={(e) => set('encodeUrl', e.target.checked)}
                />
                发送时自动 encodeURIComponent 编码参数值（关闭则原样发送）
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
          <div className="doc-pane">
            <div className="doc-toolbar">
              <button className={`btn-text ${!docPreview ? 'doc-mode-on' : ''}`} onClick={() => setDocPreview(false)}>编辑</button>
              <button className={`btn-text ${docPreview ? 'doc-mode-on' : ''}`} onClick={() => setDocPreview(true)}>预览</button>
              <span className="env-hint">支持 Markdown：标题 / 列表 / 代码块 / 链接 / 粗斜体</span>
            </div>
            {docPreview ? (
              request.doc
                ? <div className="md-preview" dangerouslySetInnerHTML={{ __html: renderMarkdown(request.doc) }} />
                : <div className="empty-hint">暂无文档内容，切到「编辑」撰写</div>
            ) : (
              <textarea
                className="body-textarea doc-textarea"
                placeholder="请求说明文档（接口用途、参数含义、注意事项…），支持 Markdown"
                value={request.doc || ''}
                onChange={(e) => set('doc', e.target.value)}
                spellCheck={false}
              />
            )}
          </div>
        )}
        {tab === 'examples' && (
          <ExamplesPane
            examples={request.examples || []}
            onDelete={(id) => set('examples', (request.examples || []).filter((x) => x.id !== id))}
            onToMock={onExampleToMock}
          />
        )}
        </div>
      </div>
      {presetMgrOpen && (
        <HeaderPresetsModal
          presets={headerPresets}
          onChangePresets={onChangeHeaderPresets}
          onClose={() => setPresetMgrOpen(false)}
        />
      )}
      {paramPresetMgrOpen && (
        <ParamPresetsModal
          presets={paramPresets}
          onChangePresets={onChangeParamPresets}
          onClose={() => setParamPresetMgrOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * 示例响应页签：展示保存的示例响应列表，支持展开查看 / 转 Mock 路由 / 删除
 */
function ExamplesPane({ examples, onDelete, onToMock }) {
  const [openId, setOpenId] = useState(null);

  if (examples.length === 0) {
    return (
      <div className="empty-hint">
        暂无示例响应。发送请求后在响应面板点「存为示例」，可把典型响应固化到请求上，随集合导出共享，并可一键生成 Mock 路由。
      </div>
    );
  }

  return (
    <div className="examples-pane">
      {examples.map((ex) => (
        <div key={ex.id} className="example-item">
          <div className="example-head" onClick={() => setOpenId(openId === ex.id ? null : ex.id)}>
            <span className={`status-tag ${ex.status < 400 ? 'status-good' : 'status-bad'}`}>{ex.status}</span>
            <span className="example-name">{ex.name}</span>
            <span className="meta">{ex.contentType.split(';')[0]}</span>
            <span className="flex-spacer" />
            <span className="meta">{ex.savedAt ? new Date(ex.savedAt).toLocaleString() : ''}</span>
            <button
              className="btn-text"
              title="用该示例的状态码/响应体生成 Mock 路由"
              onClick={(e) => { e.stopPropagation(); onToMock && onToMock(ex); }}
            >转 Mock</button>
            <span className="item-delete" title="删除示例" onClick={(e) => { e.stopPropagation(); onDelete(ex.id); }}>×</span>
          </div>
          {openId === ex.id && (
            <pre className="example-body">{ex.body || '（空响应体）'}</pre>
          )}
        </div>
      ))}
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
            fontSize={fontSize}
            tabSize={tabSize}
            wordWrap={wordWrap}
            showLineNumbers={showLineNumbers}
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
            fontSize={fontSize}
            tabSize={tabSize}
            wordWrap={wordWrap}
            showLineNumbers={showLineNumbers}
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
