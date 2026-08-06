import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { maskFade, modalPop } from '../utils/motionPresets.js';
import KeyValueEditor, { rowsToBulkText, bulkTextToRows } from './KeyValueEditor.jsx';
import { newPresetId } from '../utils/headerPresets.js';
import { parseCurl, parseRawHttp } from '../utils/curlUtil.js';
import { AUTH_TYPES, normalizeAuth } from '../utils/authUtil.js';
import { CODEGEN_LANGS, generateCode } from '../utils/codegenUtil.js';
import { THEMES, ACCENTS, LAYOUTS } from '../utils/themeUtil.js';

/**
 * 通用模态框容器
 */
export function Modal({ title, onClose, children, width = 480 }) {
  return (
    <motion.div className="modal-mask" onClick={onClose} {...maskFade}>
      <motion.div className="modal" style={{ width }} onClick={(e) => e.stopPropagation()} {...modalPop}>
        <div className="modal-header">
          <span>{title}</span>
          <span className="item-delete" onClick={onClose}>×</span>
        </div>
        <div className="modal-body">{children}</div>
      </motion.div>
    </motion.div>
  );
}

/**
 * 通用文本输入弹窗：替代 window.prompt（Electron 渲染进程不支持 prompt）
 */
export function PromptModal({ title, label, defaultValue, onConfirm, onClose }) {
  const [value, setValue] = useState(defaultValue || '');
  const submit = () => { if (value.trim()) onConfirm(value.trim()); };

  return (
    <Modal title={title} onClose={onClose} width={380}>
      <label className="modal-label">{label}</label>
      <input
        className="modal-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        onFocus={(e) => e.target.select()}
        autoFocus
      />
      <div className="modal-footer">
        <button className="btn-secondary" onClick={onClose}>取消</button>
        <button className="btn-primary" disabled={!value.trim()} onClick={submit}>确定</button>
      </div>
    </Modal>
  );
}

/**
 * 通用确认弹窗：统一替代 window.confirm，危险操作确认按钮红色警示
 */
export function ConfirmModal({ title, message, danger, onConfirm, onClose }) {
  return (
    <Modal title={title} onClose={onClose} width={380}>
      <div className="confirm-message">{message}</div>
      <div className="modal-footer">
        <button className="btn-secondary" onClick={onClose}>取消</button>
        <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} autoFocus>确定</button>
      </div>
    </Modal>
  );
}

/**
 * 保存请求：选择目标集合/文件夹 + 请求名称
 */
export function SaveRequestModal({ collections, defaultName, onConfirm, onClose }) {
  const [name, setName] = useState(defaultName || '未命名请求');
  const [targetId, setTargetId] = useState(collections[0] ? collections[0].id : '');

  // 把集合树拍平成带缩进的选项列表
  const options = [];
  const walk = (node, depth) => {
    options.push({ id: node.id, label: `${'　'.repeat(depth)}${depth > 0 ? '🗀 ' : ''}${node.name}` });
    (node.folders || []).forEach((f) => walk(f, depth + 1));
  };
  collections.forEach((c) => walk(c, 0));

  return (
    <Modal title="保存请求" onClose={onClose}>
      <label className="modal-label">请求名称</label>
      <input className="modal-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      <label className="modal-label">保存位置</label>
      {options.length === 0 ? (
        <div className="empty-hint">暂无集合，请先在左侧新建集合</div>
      ) : (
        <select className="modal-input" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      )}
      <div className="modal-footer">
        <button className="btn-secondary" onClick={onClose}>取消</button>
        <button
          className="btn-primary"
          disabled={!name.trim() || !targetId}
          onClick={() => onConfirm(name.trim(), targetId)}
        >保存</button>
      </div>
    </Modal>
  );
}

/**
 * 集合设置：名称 / 文档 / 集合级公共 Headers（发送时自动合并到该集合下所有请求）
 */
export function CollectionSettingsModal({ collection, onConfirm, onClose }) {
  const [name, setName] = useState(collection.name);
  const [doc, setDoc] = useState(collection.doc || '');
  const [headers, setHeaders] = useState(collection.headers || []);
  const [auth, setAuthState] = useState(() => normalizeAuth(collection.auth));
  const [tab, setTab] = useState('general');
  const setAuth = (patch) => setAuthState((a) => ({ ...a, ...patch }));

  return (
    <Modal title={`集合设置 - ${collection.name}`} onClose={onClose} width={560}>
      <div className="editor-tabs modal-tabs">
        <button className={tab === 'general' ? 'active' : ''} onClick={() => setTab('general')}>常规</button>
        <button className={tab === 'headers' ? 'active' : ''} onClick={() => setTab('headers')}>
          公共 Headers{headers.filter((h) => h.key).length > 0 && ` (${headers.filter((h) => h.key).length})`}
        </button>
        <button className={tab === 'auth' ? 'active' : ''} onClick={() => setTab('auth')}>
          授权{auth.type !== 'none' && ' ●'}
        </button>
        <button className={tab === 'doc' ? 'active' : ''} onClick={() => setTab('doc')}>文档</button>
      </div>

      {tab === 'general' && (
        <>
          <label className="modal-label">集合名称</label>
          <input className="modal-input" value={name} onChange={(e) => setName(e.target.value)} />
        </>
      )}
      {tab === 'headers' && (
        <>
          <div className="env-hint">这些 Headers 会在发送时自动附加到该集合下的所有请求（请求内同名 Header 优先）</div>
          <KeyValueEditor rows={headers} onChange={setHeaders} keyPlaceholder="Header 名" valuePlaceholder="Header 值" />
        </>
      )}
      {tab === 'auth' && (
        <div className="auth-editor modal-auth">
          <div className="env-hint">集合授权会自动继承给该集合下所有「无授权」的请求（请求自身配置了授权时优先）</div>
          <div className="auth-row">
            <span className="auth-label">授权类型</span>
            <select className="auth-type-select" value={auth.type} onChange={(e) => setAuth({ type: e.target.value })}>
              {AUTH_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
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
              <input className="auth-input" value={auth.token} onChange={(e) => setAuth({ token: e.target.value })} placeholder="支持 {{变量}}" />
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
                <input className="auth-input" value={auth.value} onChange={(e) => setAuth({ value: e.target.value })} />
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
        </div>
      )}
      {tab === 'doc' && (
        <textarea
          className="modal-textarea"
          placeholder="集合说明文档（支持纯文本 / Markdown 源码）"
          value={doc}
          onChange={(e) => setDoc(e.target.value)}
          spellCheck={false}
        />
      )}

      <div className="modal-footer">
        <button className="btn-secondary" onClick={onClose}>取消</button>
        <button
          className="btn-primary"
          disabled={!name.trim()}
          onClick={() => onConfirm({ name: name.trim(), doc, headers, auth })}
        >保存设置</button>
      </div>
    </Modal>
  );
}

/**
 * cURL / 原始 HTTP 报文导入：粘贴文本生成调试请求
 */
export function CurlImportModal({ onConfirm, onClose }) {
  const [mode, setMode] = useState('curl'); // 'curl' | 'raw'
  const [text, setText] = useState('');
  const [error, setError] = useState('');

  const handleConfirm = () => {
    try {
      onConfirm(mode === 'curl' ? parseCurl(text) : parseRawHttp(text));
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <Modal title="导入请求" onClose={onClose} width={560}>
      <div className="editor-tabs modal-tabs">
        <button className={mode === 'curl' ? 'active' : ''} onClick={() => { setMode('curl'); setError(''); }}>cURL 命令</button>
        <button className={mode === 'raw' ? 'active' : ''} onClick={() => { setMode('raw'); setError(''); }}>原始 HTTP 报文</button>
      </div>
      <label className="modal-label">
        {mode === 'curl'
          ? '粘贴 cURL 命令（支持 -X / -H / -d / -F / -u 等常用选项）'
          : '粘贴原始 HTTP 请求报文（请求行 + Header + 空行 + Body）'}
      </label>
      <textarea
        className="modal-textarea"
        placeholder={mode === 'curl'
          ? 'curl -X POST \'https://api.example.com/login\' \\\n  -H \'Content-Type: application/json\' \\\n  -d \'{"user":"tom"}\''
          : 'POST /api/login HTTP/1.1\nHost: api.example.com\nContent-Type: application/json\n\n{"user":"tom"}'}
        value={text}
        onChange={(e) => { setText(e.target.value); setError(''); }}
        spellCheck={false}
        autoFocus
      />
      {error && <div className="script-error">解析失败：{error}</div>}
      <div className="modal-footer">
        <button className="btn-secondary" onClick={onClose}>取消</button>
        <button className="btn-primary" disabled={!text.trim()} onClick={handleConfirm}>导入</button>
      </div>
    </Modal>
  );
}

/**
 * 代码生成：将当前请求转为多种语言的 Code Snippet
 */
export function CodegenModal({ request, onClose }) {
  const [lang, setLang] = useState(CODEGEN_LANGS[0].value);
  const [copied, setCopied] = useState(false);

  const code = useMemo(() => {
    try {
      return generateCode(lang, request);
    } catch (e) {
      return `// 生成失败：${e.message}`;
    }
  }, [lang, request]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Modal title="生成代码" onClose={onClose} width={640}>
      <div className="codegen-bar">
        <select className="modal-input codegen-lang" value={lang} onChange={(e) => setLang(e.target.value)}>
          {CODEGEN_LANGS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
        <button className="btn-secondary" onClick={handleCopy}>{copied ? '已复制 ✓' : '复制代码'}</button>
      </div>
      <pre className="codegen-code">{code}</pre>
      <div className="env-hint">已应用环境变量替换与授权配置；参数表中启用的行已合并到 URL</div>
    </Modal>
  );
}

/**
 * 导出集合：选择导出格式（ReqMock JSON / Postman / Markdown 文档）
 */
export function ExportCollectionModal({ collection, onConfirm, onClose }) {
  const formats = [
    { key: 'reqmock', title: 'ReqMock JSON', desc: '本工具原生格式，可在其他设备的 ReqMock 中导入' },
    { key: 'postman', title: 'Postman Collection v2.1', desc: '可导入 Postman / Apifox / Hoppscotch 等工具' },
    { key: 'markdown', title: 'Markdown 接口文档', desc: '生成可直接分享给团队的接口文档（.md）' }
  ];

  return (
    <Modal title={`导出集合 - ${collection.name}`} onClose={onClose}>
      <div className="export-format-list">
        {formats.map((f) => (
          <div key={f.key} className="export-format-item" onClick={() => onConfirm(f.key)}>
            <div className="export-format-title">{f.title}</div>
            <div className="export-format-desc">{f.desc}</div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

/**
 * 应用设置：主题 / 强调色 / 请求响应布局 / Cookie 自动管理开关 / 数据备份
 */
export function SettingsModal({ settings, onChange, onBackup, onRestore, onCheckUpdate, onClose }) {
  return (
    <Modal title="设置" onClose={onClose} width={440}>
      <div className="settings-row">
        <span className="settings-label">外观主题</span>
        <div className="seg-group">
          {THEMES.map((t) => (
            <button
              key={t.value}
              className={`seg-btn ${settings.theme === t.value ? 'active' : ''}`}
              onClick={() => onChange({ theme: t.value })}
            >
              {t.dark ? '☾' : '☀'} {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-label">强调色</span>
        <span className="accent-picker">
          {ACCENTS.map((a) => (
            <span
              key={a.value}
              className={`accent-dot ${settings.accent === a.value ? 'active' : ''}`}
              style={{ background: a.color }}
              title={a.label}
              onClick={() => onChange({ accent: a.value })}
            />
          ))}
        </span>
      </div>
      <div className="settings-row">
        <span className="settings-label">请求响应布局</span>
        <div className="seg-group">
          {LAYOUTS.map((l) => (
            <button
              key={l.value}
              className={`seg-btn ${settings.layout === l.value ? 'active' : ''}`}
              onClick={() => onChange({ layout: l.value })}
            >
              {l.value === 'vertical' ? '⊟' : '◫'} {l.label}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <span className="settings-label">Cookie 管理</span>
        <label className="inline-label">
          <input
            type="checkbox"
            checked={settings.cookiesEnabled}
            onChange={(e) => onChange({ cookiesEnabled: e.target.checked })}
          />
          自动记录 Set-Cookie 并在发送时附加匹配 Cookie
        </label>
      </div>
      <div className="settings-row settings-row-top">
        <span className="settings-label">数据备份</span>
        <div className="settings-backup">
          <div className="seg-group">
            <button className="btn-secondary" onClick={onBackup}>备份到文件…</button>
            <button className="btn-secondary" onClick={onRestore}>从备份恢复…</button>
          </div>
          <div className="settings-backup-hint">备份包含集合 / 环境 / 全局变量 / 历史 / Mock / Cookie / 设置；恢复将覆盖当前数据</div>
        </div>
      </div>
      <div className="env-hint">快捷键：Ctrl+Enter 发送 · Ctrl+S 保存 · Ctrl+T 新建标签 · Ctrl+W 关闭标签 · Ctrl+Shift+N 新建窗口</div>
      <div className="about-block">
        <img className="about-logo" src="./icon.png" alt="" />
        <div className="about-meta">
          <div className="about-name">ReqMock <span className="about-version">v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'}</span></div>
          <div className="about-desc">API 调试客户端 + Mock 服务桌面工具 · <a className="about-link" href="https://github.com/leleworld/ReqMock" target="_blank" rel="noreferrer">GitHub</a></div>
        </div>
        <button className="btn-secondary about-update-btn" onClick={onCheckUpdate}>检查更新</button>
      </div>
      <div className="modal-footer">
        <button className="btn-primary" onClick={onClose}>完成</button>
      </div>
    </Modal>
  );
}

/**
 * HTTP 请求头预设管理弹窗：左侧预设列表（内置 + 自定义），右侧编辑区
 * 选中条目载入编辑；「新建预设」进入空白态；保存新增或覆盖，删除任意预设
 */
export function HeaderPresetsModal({ presets, onChangePresets, onClose }) {
  const [selectedId, setSelectedId] = useState(null); // null = 新建态
  const selected = presets.find((p) => p.id === selectedId) || null;
  const [name, setName] = useState('');
  const [text, setText] = useState('');

  const load = (p) => {
    setSelectedId(p.id);
    setName(p.name);
    setText(rowsToBulkText(p.rows));
  };
  const resetNew = () => { setSelectedId(null); setName(''); setText(''); };

  const handleSave = () => {
    const rows = bulkTextToRows(text).filter((r) => r.key);
    const trimmed = name.trim();
    if (!trimmed || rows.length === 0) return;
    if (selected) {
      onChangePresets(presets.map((p) => (p.id === selected.id ? { ...p, name: trimmed, rows } : p)));
    } else {
      onChangePresets([...presets, { id: newPresetId(), name: trimmed, builtIn: false, rows }]);
    }
    resetNew();
  };

  const handleDelete = (id) => {
    onChangePresets(presets.filter((p) => p.id !== id));
    if (selectedId === id) resetNew();
  };

  return (
    <Modal title="管理请求头预设" onClose={onClose} width={560}>
      <div className="hp-layout">
        <div className="hp-list">
          {presets.map((p) => (
            <div
              key={p.id}
              className={`hp-item ${p.id === selectedId ? 'selected' : ''}`}
              onClick={() => load(p)}
            >
              <span className="hp-item-name">{p.name}{p.builtIn && <span className="hp-builtin-tag">内置</span>}</span>
              <span className="hp-item-count">{p.rows.length} 项</span>
              <span className="item-delete" title="删除该预设" onClick={(e) => { e.stopPropagation(); handleDelete(p.id); }}>×</span>
            </div>
          ))}
          <button className={`btn-block hp-new ${selectedId === null ? 'selected' : ''}`} onClick={resetNew}>+ 新建预设</button>
        </div>
        <div className="hp-edit">
          <span className="modal-label">预设名称</span>
          <input className="modal-input" placeholder="例如：公司网关通用头" value={name} onChange={(e) => setName(e.target.value)} />
          <span className="modal-label">请求头（每行一条 key: value，行首 # 表示禁用）</span>
          <textarea
            className="modal-textarea"
            placeholder={'X-App-Id: demo\nAuthorization: Bearer {{token}}'}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>关闭</button>
            <button
              className="btn-primary"
              disabled={!name.trim() || !bulkTextToRows(text).some((r) => r.key)}
              onClick={handleSave}
            >{selected ? '保存修改' : '添加预设'}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
