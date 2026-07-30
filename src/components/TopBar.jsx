import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { popoverRise } from '../utils/motionPresets.js';

/**
 * 顶部全局栏：Logo + ＋新建统一入口（请求/WS/SSE/Mock路由/环境/导入）+ 全局环境切换器
 * 环境切换器全局可见：带环境警示色点，悬停展示变量快速预览，Ctrl+E 循环切换
 */
export default function TopBar({
  environments, activeEnvId, globals = [], onActivateEnv, onOpenGlobals, onManageEnvs,
  onNewRequest, onNewWs, onNewSse, onNewMockRoute, onNewEnv,
  onImportCurl, onImportFile
}) {
  // 当前展开的下拉菜单：'new' | 'env' | null
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
  const pick = (fn) => () => { setMenu(null); fn(); };

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

  return (
    <div className="top-bar">
      <span className="top-logo">ReqMock</span>

      <span className="top-menu-anchor">
        <button
          className="btn-new"
          data-topbar-toggle
          title="新建请求 / 连接 / Mock 路由 / 环境"
          onClick={() => setMenu(menu === 'new' ? null : 'new')}
        >＋ 新建 <span className="caret">▾</span></button>
        <AnimatePresence>
          {menu === 'new' && (
            <motion.div className="ctx-menu topbar-menu" {...popoverRise}>
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

      <span className="flex-spacer" />

      <span className="top-menu-anchor" onMouseEnter={startPreview} onMouseLeave={stopPreview}>
        <button
          className={`env-switcher ${activeEnv ? 'on' : ''}`}
          data-topbar-toggle
          style={activeEnv && activeEnv.color ? { '--env-accent': activeEnv.color } : undefined}
          title="切换激活环境（Ctrl+E 循环切换）"
          onClick={() => { stopPreview(); setMenu(menu === 'env' ? null : 'env'); }}
        >
          <span className="env-color-dot" style={{ background: activeEnv && activeEnv.color ? activeEnv.color : 'currentColor' }} />
          {activeEnv ? activeEnv.name : '无环境'} <span className="caret">▾</span>
        </button>
        {envPreview && !menu && (
          <div className="ctx-menu topbar-menu topbar-menu-right env-preview-pop">
            <div className="env-preview-title">
              {activeEnv ? `环境「${activeEnv.name}」` : '未激活环境'}（悬停预览，点击切换）
            </div>
            {previewVars.length === 0 && <div className="empty-hint">暂无可用变量</div>}
            {previewVars.slice(0, 12).map((v) => (
              <div key={v.scope + ':' + v.key} className="env-preview-row" title={`${v.key} = ${v.value}`}>
                <span className="env-preview-scope">{v.scope === 'env' ? '◉' : '◈'}</span>
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
                <span className="ctx-check">{!activeEnvId ? '✓' : ''}</span>无环境
              </div>
              {environments.map((env) => (
                <div key={env.id} className="ctx-item" onClick={pick(() => onActivateEnv(env.id))}>
                  <span className="ctx-check">{env.id === activeEnvId ? '✓' : ''}</span>
                  {env.color && <span className="ctx-dot" style={{ background: env.color }} />}
                  <span className="ctx-label">{env.name}</span>
                  <span className="ctx-kbd">{(env.variables || []).filter((v) => v.key).length}</span>
                </div>
              ))}
              {environments.length === 0 && (
                <div className="ctx-item" onClick={pick(onNewEnv)}>＋ 新建环境…</div>
              )}
              <div className="ctx-sep" />
              <div className="ctx-item" onClick={pick(onOpenGlobals)}>◈ 全局变量</div>
              <div className="ctx-item" onClick={pick(onManageEnvs)}>✎ 管理环境…</div>
            </motion.div>
          )}
        </AnimatePresence>
      </span>
    </div>
  );
}
