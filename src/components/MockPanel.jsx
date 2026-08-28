import React, { useRef } from 'react';
import KeyValueEditor from './KeyValueEditor.jsx';
import CodeEditor from './CodeEditor.jsx';
import EmptyGuide from './EmptyGuide.jsx';

const METHODS = ['ANY', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

// 与 electron/mockRender.cjs 的 RANDOM_KEYS 保持一致（渲染进程无法直接引用主进程 CJS 模块）
const RANDOM_KEYS = ['int', 'float', 'bool', 'name', 'word', 'email', 'phone', 'city', 'date', 'ip', 'color'];

/** 插入变量菜单项：请求上下文 + 智能随机变量 */
const TEMPLATE_VARS = [
  { label: '请求上下文', tokens: ['{{params.id}}', '{{query.kw}}', '{{header.token}}', '{{body.name}}', '{{now}}', '{{uuid}}'] },
  { label: '智能随机', tokens: RANDOM_KEYS.map((k) => `{{random.${k}}}`) }
];

const RULE_SOURCES = [
  { value: 'query', label: 'Query 参数' },
  { value: 'header', label: 'Header' },
  { value: 'param', label: '路径参数' },
  { value: 'body', label: 'Body 字段' }
];
const RULE_OPS = [
  { value: 'eq', label: '等于' },
  { value: 'neq', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'exists', label: '存在' },
  { value: 'not-exists', label: '不存在' }
];

function newRule() {
  return {
    id: crypto.randomUUID(),
    name: '',
    enabled: true,
    when: { source: 'query', key: '', op: 'eq', value: '' },
    status: 200,
    headers: [],
    body: '',
    delayMs: null
  };
}

const SCRIPT_PLACEHOLDER = `// 可用：request.{method,path,params,query,headers,body}、response.{status,headers,body}
// 示例：
// if (request.query.type === 'vip') {
//   response.status = 200;
//   response.body = { level: 'vip', id: request.params.id };
// } else {
//   response.status = 403;
//   response.body = { error: 'forbidden' };
// }`;

/**
 * Mock 面板：服务控制条 + 路由编辑器 + 请求日志
 */
export default function MockPanel(props) {
  const {
    mock, mockRunning, mockBusy, mockLogs, selectedRouteId,
    onPortChange, onToggle,
    onUpdateRoute, onDeleteRoute, onRouteToRequest, onClearLogs,
    fontSize, tabSize, wordWrap, showLineNumbers
  } = props;

  const route = mock.routes.find((r) => r.id === selectedRouteId) || null;

  const set = (field, value) => onUpdateRoute({ ...route, [field]: value });
  const bodyRef = useRef(null);

  const responseMode = route && route.responseMode === 'script' ? 'script' : 'template';
  const rules = (route && route.rules) || [];

  const setRule = (index, patch) => {
    set('rules', rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };
  const moveRule = (index, dir) => {
    const to = index + dir;
    if (to < 0 || to >= rules.length) return;
    const next = [...rules];
    [next[index], next[to]] = [next[to], next[index]];
    set('rules', next);
  };

  /** 在 Body 编辑区光标处插入模板变量（textarea） */
  const insertVar = (token) => {
    const ta = bodyRef.current;
    if (!ta) {
      set('body', (route.body || '') + token);
      return;
    }
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? start;
    const next = ta.value.slice(0, start) + token + ta.value.slice(end);
    set('body', next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + token.length;
    });
  };

  return (
    <div className="mock-panel">
      <div className="mock-control-bar">
        <span className={`dot ${mockRunning ? 'dot-running' : 'dot-stopped'}`} />
        <span className="mock-title">Mock 服务</span>
        <label className="port-label">
          端口
          <input
            className="port-input"
            type="number"
            value={mock.port}
            disabled={mockRunning}
            onChange={(e) => onPortChange(parseInt(e.target.value, 10) || 3600)}
          />
        </label>
        <button className={mockRunning ? 'btn-danger' : 'btn-primary'} disabled={mockBusy} onClick={onToggle}>
          {mockBusy ? (mockRunning ? '停止中…' : '启动中…') : (mockRunning ? '停止' : '启动')}
        </button>
        {mockRunning && <span className="meta">http://localhost:{mock.port}</span>}
      </div>

      <div className="mock-body">
        <div className="mock-editor">
          {!route ? (
            <div className="response-placeholder">从左侧选择或新建一个 Mock 路由</div>
          ) : (
            <>
              <div className="mock-route-bar">
                <input
                  className="route-name-input"
                  value={route.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="路由名称"
                />
                <label className="inline-label">
                  <input
                    type="checkbox"
                    checked={route.enabled !== false}
                    onChange={(e) => set('enabled', e.target.checked)}
                  />
                  启用
                </label>
                <button className="btn-secondary" onClick={() => onRouteToRequest(route)}>转调试请求</button>
                <button className="btn-danger" onClick={() => onDeleteRoute(route.id)}>删除</button>
              </div>

              <div className="mock-route-bar">
                <select
                  className={`method-select method-${route.method}`}
                  value={route.method}
                  onChange={(e) => set('method', e.target.value)}
                >
                  {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                <input
                  className="url-input"
                  value={route.path}
                  onChange={(e) => set('path', e.target.value)}
                  placeholder="/api/user/:id 支持 :参数 与 * 通配"
                />
                <label className="inline-label">
                  状态码
                  <input
                    className="num-input"
                    type="number"
                    value={route.status}
                    onChange={(e) => set('status', parseInt(e.target.value, 10) || 200)}
                  />
                </label>
                <label className="inline-label">
                  延迟(ms)
                  <input
                    className="num-input"
                    type="number"
                    value={route.delayMs}
                    onChange={(e) => set('delayMs', parseInt(e.target.value, 10) || 0)}
                  />
                </label>
              </div>

              <div className="mock-section-title">响应 Headers</div>
              <KeyValueEditor
                rows={route.headers || []}
                onChange={(rows) => set('headers', rows)}
                keyPlaceholder="Header 名"
                valuePlaceholder="Header 值"
              />

              <div className="mock-section-title">
                条件规则
                <span className="hint">按顺序评估，首个命中的规则生效；均未命中时回落下方默认响应</span>
                <button className="btn-text" onClick={() => set('rules', [...rules, newRule()])}>+ 添加规则</button>
              </div>
              {rules.length > 0 && responseMode === 'script' && (
                <div className="env-hint">脚本模式下条件规则不生效，响应完全由脚本控制</div>
              )}
              {rules.map((rule, i) => (
                <div key={rule.id || i} className="mock-rule">
                  <div className="mock-rule-head">
                    <input
                      type="checkbox"
                      checked={rule.enabled !== false}
                      onChange={(e) => setRule(i, { enabled: e.target.checked })}
                    />
                    <input
                      className="rule-name-input"
                      placeholder={`规则 ${i + 1}`}
                      value={rule.name || ''}
                      onChange={(e) => setRule(i, { name: e.target.value })}
                    />
                    <button className="btn-text" title="上移" disabled={i === 0} onClick={() => moveRule(i, -1)}>↑</button>
                    <button className="btn-text" title="下移" disabled={i === rules.length - 1} onClick={() => moveRule(i, 1)}>↓</button>
                    <span className="item-delete" onClick={() => set('rules', rules.filter((_, idx) => idx !== i))}>×</span>
                  </div>
                  <div className="mock-rule-cond">
                    <span className="rule-label">当</span>
                    <select
                      value={(rule.when && rule.when.source) || 'query'}
                      onChange={(e) => setRule(i, { when: { ...rule.when, source: e.target.value } })}
                    >
                      {RULE_SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                    <input
                      className="rule-key-input"
                      placeholder={rule.when && rule.when.source === 'body' ? '字段路径如 user.name' : '名称'}
                      value={(rule.when && rule.when.key) || ''}
                      onChange={(e) => setRule(i, { when: { ...rule.when, key: e.target.value } })}
                    />
                    <select
                      value={(rule.when && rule.when.op) || 'eq'}
                      onChange={(e) => setRule(i, { when: { ...rule.when, op: e.target.value } })}
                    >
                      {RULE_OPS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    {!['exists', 'not-exists'].includes((rule.when && rule.when.op) || 'eq') && (
                      <input
                        className="rule-value-input"
                        placeholder="对比值"
                        value={(rule.when && rule.when.value) || ''}
                        onChange={(e) => setRule(i, { when: { ...rule.when, value: e.target.value } })}
                      />
                    )}
                    <label className="inline-label">
                      状态码
                      <input
                        className="num-input"
                        type="number"
                        value={rule.status ?? 200}
                        onChange={(e) => setRule(i, { status: parseInt(e.target.value, 10) || 200 })}
                      />
                    </label>
                  </div>
                  <textarea
                    className="body-textarea mock-rule-body"
                    placeholder="命中时返回的 Body（支持模板变量；留空则用默认 Body）"
                    value={rule.body || ''}
                    onChange={(e) => setRule(i, { body: e.target.value })}
                    spellCheck={false}
                  />
                </div>
              ))}

              <div className="mock-section-title">
                响应 Body
                <span className="mode-switch">
                  {['template', 'script'].map((m) => (
                    <button
                      key={m}
                      className={`btn-text ${responseMode === m ? 'mode-active' : ''}`}
                      onClick={() => set('responseMode', m)}
                    >{m === 'template' ? '模板' : '脚本'}</button>
                  ))}
                </span>
                {responseMode === 'template' && (
                  <select
                    className="var-insert-select"
                    value=""
                    title="在光标处插入模板变量"
                    onChange={(e) => { if (e.target.value) insertVar(e.target.value); e.target.value = ''; }}
                  >
                    <option value="">插入变量…</option>
                    {TEMPLATE_VARS.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.tokens.map((t) => <option key={t} value={t}>{t}</option>)}
                      </optgroup>
                    ))}
                  </select>
                )}
              </div>
              {responseMode === 'template' ? (
                <textarea
                  ref={bodyRef}
                  className="body-textarea mock-body-textarea"
                  value={route.body}
                  onChange={(e) => set('body', e.target.value)}
                  spellCheck={false}
                />
              ) : (
                <CodeEditor
                  className="mock-script-code"
                  language="javascript"
                  fontSize={fontSize}
                  tabSize={tabSize}
                  wordWrap={wordWrap}
                  showLineNumbers={showLineNumbers}
                  placeholder={SCRIPT_PLACEHOLDER}
                  value={route.script || ''}
                  onChange={(v) => set('script', v)}
                />
              )}
            </>
          )}
        </div>

        <div className="mock-logs">
          <div className="mock-section-title">
            请求日志
            <button className="btn-text" onClick={onClearLogs}>清空</button>
          </div>
          <div className="log-list">
            {mockLogs.length === 0 && (
              <EmptyGuide
                title={mockRunning ? '还没有命中记录' : 'Mock 服务未启动'}
                desc={mockRunning
                  ? `客户端请求 http://localhost:${mock.port} 下配置的路由后，命中与未命中会实时列在这里。也可以在接口响应面板点「响应转 Mock」，用真实报文快速造数据。`
                  : '启动后按下方路由表拦截请求，命中记录会实时列在这里，便于对照报文调试前端逻辑。'}
                actions={mockRunning ? [] : [{ label: mockBusy ? '启动中…' : '启动 Mock 服务', onClick: onToggle }]}
              />
            )}
            {mockLogs.map((log) => (
              <div key={log.id} className={`log-item ${log.matched ? '' : 'log-unmatched'}`}>
                <span className="log-time">{log.time.substring(11, 19)}</span>
                <span className={`method method-${log.method}`}>{log.method}</span>
                <span className="log-path" title={log.path}>{log.path}</span>
                <span className={`status-tag ${log.status < 400 ? 'status-good' : 'status-bad'}`}>{log.status}</span>
                {!log.matched && <span className="log-miss">未匹配</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
