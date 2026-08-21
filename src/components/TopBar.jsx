import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { popoverRise } from '../utils/motionPresets.js';
import { JbIcon } from './Icons.jsx';
import { TOOLS } from './ToolsPanel.jsx';

/**
 * 顶部集成菜单栏（软件壳）：Logo + 应用菜单（文件/编辑/视图/工具/帮助）+ 右侧快捷动作（＋新建 / 环境切换器）
 * 菜单即功能索引：所有核心动作都能从菜单发现，快捷键以 kbd 提示展示
 * 编辑菜单经主进程 webContents 执行，保证与系统一致的复制/粘贴/撤销行为
 */

/** 菜单模型：sep 分隔线；kbd 快捷键提示；icon 为 JetBrains 图标名 */
function buildMenus(handlers) {
  return [
    {
      key: 'file', label: '文件', items: [
        { label: '新建 HTTP 请求', kbd: 'Ctrl+T', onClick: handlers.onNewRequest },
        { label: '新建 WebSocket 连接', onClick: handlers.onNewWs },
        { label: '新建 SSE 连接', onClick: handlers.onNewSse },
        { label: '新建 Mock 路由', onClick: handlers.onNewMockRoute },
        { label: '新建环境', onClick: handlers.onNewEnv },
        { sep: true },
        { label: '导入 cURL / 报文…', onClick: handlers.onImportCurl },
        { label: '导入文件…', onClick: handlers.onImportFile },
        { label: '导出工作区…', onClick: handlers.onExportAll },
        { label: '备份数据…', onClick: handlers.onBackup },
        { sep: true },
        { label: '新建窗口', kbd: 'Ctrl+Shift+N', onClick: () => window.api.newWindow() }
      ]
    },
    {
      key: 'edit', label: '编辑', items: [
        { label: '撤销', kbd: 'Ctrl+Z', onClick: () => window.api.editExec('undo') },
        { label: '重做', kbd: 'Ctrl+Y', onClick: () => window.api.editExec('redo') },
        { sep: true },
        { label: '剪切', kbd: 'Ctrl+X', onClick: () => window.api.editExec('cut') },
        { label: '复制', kbd: 'Ctrl+C', onClick: () => window.api.editExec('copy') },
        { label: '粘贴', kbd: 'Ctrl+V', onClick: () => window.api.editExec('paste') },
        { label: '全选', kbd: 'Ctrl+A', onClick: () => window.api.editExec('selectAll') }
      ]
    },
    {
      key: 'view', label: '视图', items: [
        { label: '切换请求/响应布局', onClick: handlers.onToggleLayout },
        { label: '切换控制台', onClick: handlers.onToggleConsole },
        { label: '切换侧栏', kbd: 'Alt+1', onClick: handlers.onToggleSidebar },
        { label: '命令面板', kbd: 'Ctrl+Shift+A', onClick: handlers.onOpenPalette },
        { sep: true },
        { label: '开发者工具', onClick: () => window.api.toggleDevtools() }
      ]
    },
    {
      key: 'tools', label: '工具', items: [
        { label: 'Mock 服务面板', icon: 'services', onClick: handlers.onOpenMock },
        { label: 'Cookie 管理器', icon: 'archive', onClick: handlers.onOpenCookies },
        { sep: true },
        ...TOOLS.map((t) => ({ label: t.label, icon: t.icon, onClick: () => handlers.onOpenTool(t.key) }))
      ]
    },
    {
      key: 'help', label: '帮助', items: [
        { label: '快捷键速查', kbd: 'F1', onClick: handlers.onKbd },
        { label: '欢迎与入门', onClick: handlers.onOpenWelcome },
        { sep: true },
        { label: '检查更新…', icon: 'update', onClick: handlers.onCheckUpdate },
        { label: '关于 ReqMock', icon: 'info', onClick: handlers.onAbout }
      ]
    }
  ];
}

export default function TopBar(props) {
  const {
    environments, activeEnvId, globals = [], onActivateEnv, onOpenGlobals, onManageEnvs,
    onNewRequest, onNewWs, onNewSse, onNewMockRoute, onNewEnv, onImportCurl, onImportFile
  } = props;
  // 当前展开的下拉菜单：菜单 key | 'new' | 'env' | null
  const [menu, setMenu] = useState(null);
  // 环境变量快速预览（悬停延时展示，菜单展开时不叠加）
  const [envPreview, setEnvPreview] = useState(false);
  const previewTimer = useRef(null);

  // 菜单展开后：点击弹层外部或按 Esc 自动关闭（触发按钮自身除外，避免关闭后又被切换重开）
  useEffect(() => {
    if (!menu) return;
    const onMouseDown = (e) => {
      if (!(e.target instanceof Element)) return;
      if (e.target.closest('.topbar-menu') || e.target.closest('[data-topbar-toggle]')) return;
      setMenu(null);
    };
    const onKeyDown = (e) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menu]);

  const activeEnv = environments.find((e) => e.id === activeEnvId) || null;
  /** 菜单项点击：先收起菜单再执行动作 */
  const pick = (fn) => () => { setMenu(null); fn && fn(); };

  // 预览内容：激活环境变量（同名覆盖全局）+ 全局变量，最多展示 12 条
  const envVars = activeEnv ? (activeEnv.variables || []).filter((v) => v.key) : [];
  const envKeys = new Set(envVars.map((v) => v.key));
  const globalVars = (globals || []).filter((v) => v.key && !envKeys.has(v.key));
  const previewVars = [
    ...envVars.map((v) => ({ ...v, scope: 'env' })),
    ...globalVars.map((v) => ({ ...v, scope: 'global' }))
  ];

  const startPreview = () => {
    if (menu) return;
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => setEnvPreview(true), 350);
  };
  const stopPreview = () => {
    clearTimeout(previewTimer.current);
    setEnvPreview(false);
  };

  const menus = buildMenus(props);

  return (
    <div className="top-bar">
      <span className="top-logo">ReqMock</span>

      {/* 应用菜单：文件 / 编辑 / 视图 / 工具 / 帮助 */}
      <nav className="top-menubar" aria-label="应用菜单">
        {menus.map((m) => (
          <span key={m.key} className="top-menu-anchor">
            <button
              className={`top-menu-btn ${menu === m.key ? 'open' : ''}`}
              data-topbar-toggle
              onClick={() => setMenu(menu === m.key ? null : m.key)}
              onMouseEnter={() => { if (menu && menu !== m.key) setMenu(m.key); }}
            >{m.label}</button>
            <AnimatePresence>
              {menu === m.key && (
                <motion.div className="ctx-menu topbar-menu" {...popoverRise}>
                  {m.items.map((it, i) => (
                    it.sep ? <div key={i} className="ctx-sep" /> : (
                      <div key={i} className="ctx-item" onClick={pick(it.onClick)}>
                        {it.icon && <JbIcon name={it.icon} size={14} className="ctx-icon" />}
                        <span className="ctx-label">{it.label}</span>
                        {it.kbd && <span className="ctx-kbd">{it.kbd}</span>}
                      </div>
                    )
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </span>
        ))}
      </nav>

      <span className="flex-spacer" />

      <span className="top-menu-anchor">
        <button
          className="btn-new"
          data-topbar-toggle
          title="新建请求 / 连接 / Mock 路由 / 环境"
          onClick={() => setMenu(menu === 'new' ? null : 'new')}
        ><JbIcon name="add" size={13} /> 新建 <JbIcon name="caret-down" size={10} className="caret-icon" /></button>
        <AnimatePresence>
          {menu === 'new' && (
            <motion.div className="ctx-menu topbar-menu topbar-menu-right" {...popoverRise}>
              <div className="ctx-item" onClick={pick(onNewRequest)}>HTTP 请求<span className="ctx-kbd">Ctrl+T</span></div>
              <div className="ctx-item" onClick={pick(onNewWs)}>WebSocket 连接</div>
              <div className="ctx-item" onClick={pick(onNewSse)}>SSE 连接</div>
              <div className="ctx-item" onClick={pick(onNewMockRoute)}>Mock 路由</div>
              <div className="ctx-item" onClick={pick(onNewEnv)}>环境</div>
              <div className="ctx-sep" />
              <div className="ctx-item" onClick={pick(onImportCurl)}>导入 cURL / 报文…</div>
              <div className="ctx-item" onClick={pick(onImportFile)}>导入文件…</div>
            </motion.div>
          )}
        </AnimatePresence>
      </span>

      <span className="top-menu-anchor" onMouseEnter={startPreview} onMouseLeave={stopPreview}>
        <button
          className={`env-switcher ${activeEnv ? 'on' : ''}`}
          data-topbar-toggle
          style={activeEnv && activeEnv.color ? { '--env-accent': activeEnv.color } : undefined}
          title="切换激活环境（Ctrl+E 循环切换）"
          onClick={() => { stopPreview(); setMenu(menu === 'env' ? null : 'env'); }}
        >
          <span className="env-color-dot" style={{ background: activeEnv && activeEnv.color ? activeEnv.color : 'currentColor' }} />
          {activeEnv ? activeEnv.name : '无环境'} <JbIcon name="caret-down" size={10} className="caret-icon" />
        </button>
        {envPreview && !menu && (
          <div className="ctx-menu topbar-menu topbar-menu-right env-preview-pop">
            <div className="env-preview-title">
              {activeEnv ? `环境「${activeEnv.name}」` : '未激活环境'}（悬停预览，点击切换）
            </div>
            {previewVars.length === 0 && <div className="empty-hint">暂无可用变量</div>}
            {previewVars.slice(0, 12).map((v) => (
              <div key={v.scope + ':' + v.key} className="env-preview-row" title={`${v.key} = ${v.value}`}>
                <span className="env-preview-scope"><JbIcon name={v.scope === 'env' ? 'earth' : 'galaxy'} size={12} /></span>
                <span className="env-preview-key">{v.key}</span>
                <span className="env-preview-val">{v.secret ? '••••••' : String(v.value ?? '')}</span>
              </div>
            ))}
            {previewVars.length > 12 && <div className="env-hint">共 {previewVars.length} 个变量，仅展示前 12 个</div>}
          </div>
        )}
        <AnimatePresence>
          {menu === 'env' && (
            <motion.div className="ctx-menu topbar-menu topbar-menu-right" {...popoverRise}>
              <div className="ctx-item" onClick={pick(() => onActivateEnv(null))}>
                <span className="ctx-check">{!activeEnvId ? <JbIcon name="checkmark" size={12} /> : ''}</span>无环境
              </div>
              {environments.map((env) => (
                <div key={env.id} className="ctx-item" onClick={pick(() => onActivateEnv(env.id))}>
                  <span className="ctx-check">{env.id === activeEnvId ? <JbIcon name="checkmark" size={12} /> : ''}</span>
                  {env.color && <span className="ctx-dot" style={{ background: env.color }} />}
                  <span className="ctx-label">{env.name}</span>
                  <span className="ctx-kbd">{(env.variables || []).filter((v) => v.key).length}</span>
                </div>
              ))}
              {environments.length === 0 && (
                <div className="ctx-item" onClick={pick(onNewEnv)}>＋ 新建环境…</div>
              )}
              <div className="ctx-sep" />
              <div className="ctx-item" onClick={pick(onOpenGlobals)}><JbIcon name="galaxy" size={14} className="ctx-icon" />全局变量</div>
              <div className="ctx-item" onClick={pick(onManageEnvs)}><JbIcon name="pencil" size={14} className="ctx-icon" />管理环境…</div>
            </motion.div>
          )}
        </AnimatePresence>
      </span>
    </div>
  );
}
