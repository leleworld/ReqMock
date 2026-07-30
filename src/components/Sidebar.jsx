import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { badgeSpring, tabIn } from '../utils/motionPresets.js';
import CollectionTree from './CollectionTree.jsx';
 import { TOOLS } from './ToolsPanel.jsx';
import { JbIcon } from './Icons.jsx';

/**
 * 左侧导航（Reqable 式布局）：
 * - 活动栏（窄图标竖条）：切换导航面板内容，底部为主题/设置/新窗口
 * - 导航面板（可折叠）：集合树 / 环境列表 / Mock 路由 / 历史 / Cookie 域 / 工具列表
 * 面板中的条目不直接占据主区，而是在主区以标签页打开
 */
const ACTIVITIES = [
  { key: 'collections', icon: 'folder', label: 'API 集合' },
  { key: 'env', icon: 'parameters', label: '环境变量' },
  { key: 'mocks', icon: 'cloud', label: 'Mock 服务' },
  { key: 'cookies', icon: 'data', label: 'Cookie' },
  { key: 'history', icon: 'history', label: '历史记录' },
  { key: 'tools', icon: 'magic-wand', label: '工具箱' }
];

export default function Sidebar(props) {
  const {
    activity, panelOpen, onActivity,
    collections, environments, activeEnvId,
    history, mock, mockRunning, selectedRouteId,
    cookieJar, curTab,
    onOpenRequest, onNewRequest, onNewCollection,
    onImport, onImportContent, onExportAll,
    onOpenEnv, onNewEnv, onExportEnvs,
    onSelectRoute, onAddRoute, onOpenMock,
    onOpenCookies, onOpenTool,
    onOpenHistory, onDeleteHistory, onClearHistory, onCopyHistoryCurl,
    settings, onChangeSettings, onOpenSettings,
    noticeUnread, onToggleNotices
  } = props;

  // 集合树搜索关键字 + 环境面板拖拽高亮状态
  const [colFilter, setColFilter] = useState('');
  const [envDragOver, setEnvDragOver] = useState(false);
  // 侧栏宽度拖拽中：拖拽时关闭宽度过渡动画，保证手柄跟手
  const [resizing, setResizing] = useState(false);
  const sbWidth = settings.sidebarWidth || 264;

  /** 拖拽调整侧栏宽度（200–420px，结果存入 settings 持久化） */
  const startResize = (e) => {
    e.preventDefault();
    setResizing(true);
    document.body.classList.add('resizing');
    const onMove = (ev) => {
      // 活动栏固定 46px，面板宽度 = 鼠标横坐标 - 活动栏宽度
      const w = Math.min(420, Math.max(200, ev.clientX - 46));
      onChangeSettings({ sidebarWidth: w });
    };
    const onUp = () => {
      setResizing(false);
      document.body.classList.remove('resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  /** 拖入环境/集合 JSON 文件直接导入 */
  const handleEnvDrop = (e) => {
    e.preventDefault();
    setEnvDragOver(false);
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => onImportContent && onImportContent(String(reader.result));
    reader.readAsText(file);
  };

  const activityMeta = ACTIVITIES.find((a) => a.key === activity);
  // 主区当前标签对应的导航条目高亮
  const openEnvId = curTab.kind === 'env' ? curTab.envId : null;
  const openTool = curTab.kind === 'tool' ? curTab.tool : null;

  // Cookie 按域名分组统计
  const cookieDomains = [];
  for (const c of cookieJar) {
    const found = cookieDomains.find((d) => d.domain === c.domain);
    if (found) found.count += 1;
    else cookieDomains.push({ domain: c.domain, count: 1 });
  }

  return (
    <>
      <div className="activity-bar">
        {ACTIVITIES.map((a) => (
          <button
            key={a.key}
            className={`activity-btn ${activity === a.key && panelOpen ? 'active' : ''}`}
            title={a.label}
            onClick={() => onActivity(a.key)}
          >
            <JbIcon name={a.icon} size={17} />
            {a.key === 'mocks' && mockRunning && <span className="activity-dot" title="Mock 运行中" />}
          </button>
        ))}
        <span className="activity-spacer" />
        <button className="activity-btn" title="通知中心" data-notice-toggle onClick={onToggleNotices}>
          <JbIcon name="bell" size={17} />
          {noticeUnread > 0 && (
            <motion.span className="activity-badge" key={noticeUnread} {...badgeSpring}>
              {noticeUnread > 99 ? '99+' : noticeUnread}
            </motion.span>
          )}
        </button>
        <button
          className="activity-btn"
          title={settings.theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'}
          onClick={() => onChangeSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
        >
          <JbIcon name="theme" size={17} />
        </button>
        <button className="activity-btn" title="新建窗口 (Ctrl+Shift+N)" onClick={() => window.api.newWindow()}><JbIcon name="new-window" size={16} /></button>
        <button className="activity-btn" title="设置" onClick={onOpenSettings}><JbIcon name="settings" size={17} /></button>
      </div>

      <AnimatePresence initial={false}>
      {panelOpen && (
        <motion.div
          className="side-panel"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: sbWidth, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={resizing ? { duration: 0 } : { duration: 0.18, ease: 'easeOut' }}
        >
        <div className="side-panel-inner" style={{ width: sbWidth, minWidth: sbWidth }}>
          <div className="side-panel-header">
            <span>{activityMeta ? activityMeta.label : ''}</span>
            {/* 集合面板操作区：新建请求/新建集合/导入/导出以图标按钮内联到标题栏 */}
            {activity === 'collections' && (
              <span className="panel-actions">
                <button className="panel-action" title="新建请求" onClick={onNewRequest}><JbIcon name="add" size={14} /></button>
                <button className="panel-action" title="新建集合" onClick={onNewCollection}><JbIcon name="folder" size={14} /></button>
                <button className="panel-action" title="从 JSON 文件导入（支持 ReqMock / Reqable / Postman / Hoppscotch / OpenAPI / Insomnia / HAR）" onClick={onImport}><JbIcon name="import" size={14} /></button>
                <button className="panel-action" title="导出全部集合与环境" onClick={onExportAll}><JbIcon name="export" size={14} /></button>
              </span>
            )}
            <span className="panel-collapse" title="折叠面板" onClick={() => onActivity(activity)}>«</span>
          </div>

          <div className="side-panel-body">
            {/* key 随活动项变化触发内容切换微动效 */}
            <motion.div className="side-panel-pane" key={activity} {...tabIn}>
            {activity === 'collections' && (
              <>
                <div className="tree-search-wrap">
                  <JbIcon name="search" size={13} />
                  <input
                    className="tree-search"
                    placeholder="搜索集合 / 请求…"
                    value={colFilter}
                    onChange={(e) => setColFilter(e.target.value)}
                  />
                </div>
                <CollectionTree {...props} filter={colFilter} />
              </>
            )}

            {activity === 'env' && (
              <div
                className={`env-drop-zone ${envDragOver ? 'drag-over' : ''}`}
                onDragOver={(e) => { e.preventDefault(); setEnvDragOver(true); }}
                onDragLeave={() => setEnvDragOver(false)}
                onDrop={handleEnvDrop}
              >
                <div className="sidebar-toolbar">
                  <button className="btn-block" onClick={onNewEnv}>+ 新建环境</button>
                  <button className="btn-block" title="从 JSON 文件导入环境（支持 ReqMock / Reqable / Postman / Hoppscotch / Insomnia）" onClick={onImport}>导入</button>
                  <button className="btn-block" title="导出全部环境与全局变量" onClick={onExportEnvs}>导出</button>
                </div>
                <div
                  className={`list-item ${openEnvId === '__globals__' ? 'selected' : ''}`}
                  onClick={() => onOpenEnv('__globals__')}
                  title="全局变量对所有环境生效，同名时被环境变量覆盖"
                >
                  <span className="env-dot env-dot-global">◈</span>
                  <span className="item-name">全局变量</span>
                  <span className="tree-count">{(props.globals || []).filter((v) => v.key).length}</span>
                </div>
                {environments.length === 0 && <div className="empty-hint">暂无环境</div>}
                {environments.map((env) => (
                  <div
                    key={env.id}
                    className={`list-item ${env.id === openEnvId ? 'selected' : ''}`}
                    onClick={() => onOpenEnv(env.id)}
                  >
                    <span className={`env-dot ${env.id === activeEnvId ? 'env-dot-active' : ''}`}>◉</span>
                    <span className="item-name">{env.name}</span>
                    <span className="tree-count">{(env.variables || []).filter((v) => v.key).length}</span>
                  </div>
                ))}
                <div className="env-hint">可将环境 / 集合 JSON 文件拖入此处导入</div>
              </div>
            )}

            {activity === 'mocks' && (
              <>
                <div className="sidebar-toolbar">
                  <button className="btn-block" onClick={onAddRoute}>+ 新建路由</button>
                  <button className="btn-block" onClick={onOpenMock}>
                    {mockRunning ? <span className="dot-running" /> : <span className="dot-stopped" />} 服务面板
                  </button>
                </div>
                {mock.routes.length === 0 && <div className="empty-hint">暂无 Mock 路由</div>}
                {mock.routes.map((route) => (
                  <div
                    key={route.id}
                    className={`list-item ${route.id === selectedRouteId && curTab.kind === 'mock' ? 'selected' : ''} ${route.enabled === false ? 'disabled' : ''}`}
                    onClick={() => onSelectRoute(route.id)}
                  >
                    <span className={`method method-${route.method}`}>{route.method}</span>
                    <span className="item-name" title={route.path}>{route.name}</span>
                  </div>
                ))}
              </>
            )}

            {activity === 'cookies' && (
              <>
                <div className="sidebar-toolbar">
                  <button className="btn-block" onClick={onOpenCookies}>打开 Cookie 管理器</button>
                </div>
                {cookieDomains.length === 0 && <div className="empty-hint">暂无 Cookie（发送请求后自动记录 Set-Cookie）</div>}
                {cookieDomains.map((d) => (
                  <div key={d.domain} className="list-item" onClick={onOpenCookies}>
                    <span className="env-dot">◍</span>
                    <span className="item-name" title={d.domain}>{d.domain}</span>
                    <span className="tree-count">{d.count}</span>
                  </div>
                ))}
              </>
            )}

            {activity === 'history' && (
              <HistoryPane
                history={history}
                onOpen={onOpenHistory || onOpenRequest}
                onDelete={onDeleteHistory}
                onClear={onClearHistory}
                onCopyCurl={onCopyHistoryCurl}
              />
            )}

            {activity === 'tools' && (
              <>
                {TOOLS.map((t) => (
                  <div
                    key={t.key}
                    className={`list-item tool-list-item ${openTool === t.key ? 'selected' : ''}`}
                    onClick={() => onOpenTool(t.key)}
                  >
                    <span className="tool-item-icon">{t.icon}</span>
                    <span className="tool-item-text">
                      <span className="item-name">{t.label}</span>
                      <span className="tool-item-desc">{t.desc}</span>
                    </span>
                  </div>
                ))}
              </>
            )}
            </motion.div>
          </div>
        </div>
        </motion.div>
      )}
      </AnimatePresence>
      {/* 侧栏宽度拖拽手柄：悬停/拖拽时高亮为强调色 */}
      {panelOpen && (
        <div
          className={`panel-resizer ${resizing ? 'dragging' : ''}`}
          title="拖拽调整面板宽度"
          onMouseDown={startResize}
        />
      )}
    </>
  );
}

/** 历史面板：按域名分组折叠，条目带状态/耗时徽标，右键菜单支持打开/查看当时响应/复制 cURL/删除 */
function HistoryPane({ history, onOpen, onDelete, onClear, onCopyCurl }) {
  const [menu, setMenu] = useState(null); // { item, x, y }
  const [collapsed, setCollapsed] = useState({}); // domain -> 是否折叠

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  // 按域名分组（保持时间倒序，组顺序按首次出现）
  const groups = [];
  for (const item of history) {
    let domain = '（未知地址）';
    try { domain = new URL(item.url).host || domain; } catch (e) { /* URL 不完整 */ }
    let g = groups.find((x) => x.domain === domain);
    if (!g) { g = { domain, items: [] }; groups.push(g); }
    g.items.push(item);
  }

  /** 去掉 origin 只显示路径，分组后更紧凑 */
  const pathOf = (url) => {
    try {
      const u = new URL(url);
      return (u.pathname || '/') + u.search;
    } catch (e) { return url || '(空)'; }
  };

  const fmtTime = (t) => {
    const d = new Date(t);
    return isNaN(d) ? '' : d.toLocaleString();
  };

  return (
    <>
      {history.length === 0 && <div className="empty-hint">暂无历史记录，发送请求后自动记录</div>}
      {history.length > 0 && (
        <div className="sidebar-toolbar">
          <button className="btn-block" title="清空全部历史记录" onClick={onClear}>清空历史（{history.length}）</button>
        </div>
      )}
      {groups.map((g) => (
        <div key={g.domain} className="history-group">
          <div
            className="history-group-head"
            title={g.domain}
            onClick={() => setCollapsed((prev) => ({ ...prev, [g.domain]: !prev[g.domain] }))}
          >
            <span className="tree-arrow">{collapsed[g.domain] ? '▸' : '▾'}</span>
            <span className="item-name">{g.domain}</span>
            <span className="tree-count">{g.items.length}</span>
          </div>
          {!collapsed[g.domain] && g.items.map((item) => (
            <div
              key={item.id}
              className="list-item history-item"
              title={`${item.url}\n${fmtTime(item.time)}${item.responseSnapshot ? '\n右键可查看当时响应' : ''}`}
              onClick={() => onOpen(item)}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ item, x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 200) });
              }}
            >
              <span className={`method method-${item.method}`}>{item.method}</span>
              <span className="item-name">{pathOf(item.url)}</span>
              {item.timeMs != null && <span className="history-ms">{item.timeMs}ms</span>}
              <span className={`status-tag ${item.status === 'ERR' || item.status >= 400 ? 'status-bad' : 'status-good'}`}>
                {item.status}
              </span>
            </div>
          ))}
        </div>
      ))}
      {menu && (
        <div className="ctx-menu" style={{ position: 'fixed', left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="ctx-item" onClick={() => { onOpen(menu.item); setMenu(null); }}>打开请求</div>
          {menu.item.responseSnapshot && (
            <div className="ctx-item" onClick={() => { onOpen(menu.item, true); setMenu(null); }}>打开并查看当时响应</div>
          )}
          {onCopyCurl && (
            <div className="ctx-item" onClick={() => { onCopyCurl(menu.item); setMenu(null); }}>复制为 cURL</div>
          )}
          <div className="ctx-sep" />
          {onDelete && (
            <div className="ctx-item ctx-danger" onClick={() => { onDelete(menu.item.id); setMenu(null); }}>删除该记录</div>
          )}
        </div>
      )}
    </>
  );
}
