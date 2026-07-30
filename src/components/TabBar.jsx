import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { GROUP_COLORS } from '../utils/tabGroupUtil.js';
import { tabIn } from '../utils/motionPresets.js';

/**
 * 主区统一标签栏：请求 / 环境 / Cookie / Mock / 工具都以标签页承载（Reqable 式）
 * 非请求标签由 tabMeta 提供图标与名称
 * 支持 Chrome 式标签分组：同组标签包进组色容器（徽标 + 底色条），可折叠；右键菜单管理分组
 */
export default function TabBar({
  tabs, groups, activeTabId, tabMeta, isTabDirty,
  onSelect, onClose, onNew, onNewWs, onNewSse,
  onNewGroup, onAssignGroup, onLeaveGroup,
  onRenameGroup, onRecolorGroup, onToggleGroupCollapse, onUngroup, onCloseGroup
}) {
  // 右键菜单：{ type: 'tab', tabId } | { type: 'group', groupId } | { type: 'add' }，含 x/y 弹出坐标
  const [menu, setMenu] = useState(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const openMenu = (e, m) => {
    e.preventDefault();
    setMenu({ ...m, x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 240) });
  };

  const groupOf = (gid) => (groups || []).find((g) => g.id === gid) || null;
  const memberCount = (gid) => tabs.filter((t) => t.groupId === gid).length;

  // 单个标签渲染（组内/组外通用，组色由容器 CSS 变量接管）
  const renderTab = (tab) => {
    const isReq = !tab.kind || tab.kind === 'request';
    const meta = isReq ? null : tabMeta(tab);
    const active = tab.id === activeTabId;
    const dirty = isReq && isTabDirty && isTabDirty(tab);
    return (
      <div
        key={tab.id}
        className={`tab-item ${active ? 'active' : ''} ${tab.groupId ? 'in-group' : ''}`}
        title={isReq ? (tab.request.url || tab.request.name) : meta.title}
        onClick={() => onSelect(tab.id)}
        onContextMenu={(e) => openMenu(e, { type: 'tab', tabId: tab.id })}
      >
        {isReq ? (
          <span className={`method method-${tab.request.method}`}>{tab.request.method}</span>
        ) : (
          <span className="tab-icon">{meta.icon}</span>
        )}
        <span className="tab-name">{isReq ? (tab.request.name || '未命名请求') : meta.label}</span>
        {isReq && tab.sending && <span className="tab-sending" title="发送中">●</span>}
        {dirty && !tab.sending && <span className="tab-dirty" title="有未保存的修改 (Ctrl+S 保存)">●</span>}
        <span
          className="tab-close"
          title="关闭标签页 (Ctrl+W)"
          onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
        >×</span>
      </div>
    );
  };

  // 按顺序渲染：同组连续标签包进带组色底条的容器；折叠的分组只保留激活标签
  const items = [];
  let i = 0;
  while (i < tabs.length) {
    const tab = tabs[i];
    const group = tab.groupId ? groupOf(tab.groupId) : null;
    if (!group) {
      items.push(renderTab(tab));
      i++;
      continue;
    }
    const members = [];
    while (i < tabs.length && tabs[i].groupId === group.id) {
      members.push(tabs[i]);
      i++;
    }
    const shown = group.collapsed ? members.filter((t) => t.id === activeTabId) : members;
    items.push(
      <motion.div
        key={'grp-' + group.id}
        className={`tab-group ${group.collapsed ? 'collapsed' : ''}`}
        style={{ '--group-color': group.color }}
        {...tabIn}
      >
        <div
          className="tab-group-chip"
          title={`分组「${group.name}」（${members.length} 个标签）\n单击折叠/展开，右键管理分组`}
          onClick={() => onToggleGroupCollapse(group.id)}
          onContextMenu={(e) => openMenu(e, { type: 'group', groupId: group.id })}
        >
          <span className="tab-group-name">{group.name}</span>
          <span className="tab-group-count">{members.length}</span>
        </div>
        {shown.map(renderTab)}
      </motion.div>
    );
  }

  const menuTab = menu && menu.type === 'tab' ? tabs.find((t) => t.id === menu.tabId) : null;
  const menuGroup = menu && menu.type === 'group' ? groupOf(menu.groupId) : null;

  return (
    <div className="tab-bar">
      <div className="tab-list">
        {items}
        <button
          className="tab-add"
          title="新建标签页 (Ctrl+T 新建请求)"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setMenu({ type: 'add', x: Math.min(rect.left, window.innerWidth - 200), y: rect.bottom + 4 });
          }}
        >＋</button>
      </div>

      {menu && menu.type === 'add' && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="ctx-item" onClick={() => { onNew(); setMenu(null); }}>HTTP 请求</div>
          <div className="ctx-item" onClick={() => { onNewWs(); setMenu(null); }}>WebSocket 连接</div>
          <div className="ctx-item" onClick={() => { onNewSse(); setMenu(null); }}>SSE 连接</div>
        </div>
      )}

      {menuTab && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="ctx-item" onClick={() => { onNewGroup(menuTab.id); setMenu(null); }}>添加到新分组…</div>
          {(groups || []).filter((g) => g.id !== menuTab.groupId).map((g) => (
            <div key={g.id} className="ctx-item" onClick={() => { onAssignGroup(menuTab.id, g.id); setMenu(null); }}>
              <span className="ctx-dot" style={{ background: g.color }} />加入「{g.name}」
            </div>
          ))}
          {menuTab.groupId && (
            <div className="ctx-item" onClick={() => { onLeaveGroup(menuTab.id); setMenu(null); }}>从分组中移除</div>
          )}
          <div className="ctx-sep" />
          <div className="ctx-item ctx-danger" onClick={() => { onClose(menuTab.id); setMenu(null); }}>关闭标签页</div>
        </div>
      )}

      {menuGroup && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="ctx-colors">
            {GROUP_COLORS.map((c) => (
              <span
                key={c}
                className={`ctx-color ${menuGroup.color === c ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => onRecolorGroup(menuGroup.id, c)}
              />
            ))}
          </div>
          <div className="ctx-sep" />
          <div className="ctx-item" onClick={() => { onRenameGroup(menuGroup.id); setMenu(null); }}>重命名分组…</div>
          <div className="ctx-item" onClick={() => { onToggleGroupCollapse(menuGroup.id); setMenu(null); }}>
            {menuGroup.collapsed ? '展开分组' : '折叠分组'}
          </div>
          <div className="ctx-item" onClick={() => { onUngroup(menuGroup.id); setMenu(null); }}>取消分组（保留标签）</div>
          <div className="ctx-sep" />
          <div className="ctx-item ctx-danger" onClick={() => { onCloseGroup(menuGroup.id); setMenu(null); }}>关闭分组内所有标签</div>
        </div>
      )}
    </div>
  );
}
