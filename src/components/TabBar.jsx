import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { GROUP_COLORS } from '../utils/tabGroupUtil.js';
import { tabIn } from '../utils/motionPresets.js';
import { JbIcon } from './Icons.jsx';

/**
 * 主区统一标签栏：请求 / 环境 / Cookie / Mock / 工具都以标签页承载（Reqable 式）
 * 非请求标签由 tabMeta 提供图标与名称
 * 支持 Chrome 式标签分组：同组标签包进组色容器（徽标 + 底色条），可折叠；右键菜单管理分组
 * 标签溢出时横向滚动，左右三角按钮 + 右侧「全部标签」下拉快速定位
 * 支持固定（Pin）：被固定的标签/分组常驻左侧固定区，不随滚动、防误关
 */
export default function TabBar({
  tabs, groups, activeTabId, tabMeta, isTabDirty,
  onSelect, onClose, onNew, onNewWs, onNewSse,
  onNewGroup, onAssignGroup, onLeaveGroup, onCloseAll, onCloseToRight, onCloseToLeft,
  onRenameGroup, onRecolorGroup, onToggleGroupCollapse, onUngroup, onCloseGroup,
  onTogglePinTab, onTogglePinGroup
}) {
  // 右键菜单：{ type: 'tab', tabId } | { type: 'group', groupId } | { type: 'add' } | { type: 'all' }，含 x/y 弹出坐标
  const [menu, setMenu] = useState(null);
  // 标签溢出检测：内容宽度超出可视宽度时显示「全部标签」下拉；同时跟踪左右可滚方向用于边缘渐隐提示
  const listRef = useRef(null);
  const [overflowing, setOverflowing] = useState(false);
  const [fadeL, setFadeL] = useState(false);
  const [fadeR, setFadeR] = useState(false);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const check = () => {
      const over = el.scrollWidth > el.clientWidth + 4;
      setOverflowing(over);
      setFadeL(over && el.scrollLeft > 4);
      setFadeR(over && el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
    };
    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', check);
      ro.disconnect();
    };
  }, [tabs.length]);

  // 鼠标滚轮横向滚动：纵向滚轮映射为标签列表横向滚动（无可横向空间时放行，避免拦截页面滚动）
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onWheel = (e) => {
      if (el.scrollWidth <= el.clientWidth + 4) return;
      const delta = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 1) return;
      e.preventDefault();
      el.scrollLeft += delta;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // 激活标签自动滚入可视区：被挤出视区时平滑滚动到位；折叠组内的激活标签回退滚到组牌
  useEffect(() => {
    const list = listRef.current;
    if (!list || !activeTabId) return;
    const activeTab = tabs.find((t) => t.id === activeTabId);
    const target = list.querySelector(`[data-tab-id="${activeTabId}"]`)
      || (activeTab && activeTab.groupId
        ? list.querySelector(`[data-group-id="${activeTab.groupId}"]`)
        : null);
    if (target) target.scrollIntoView({ behavior: 'smooth', inline: 'nearest', block: 'nearest' });
  }, [activeTabId, tabs.length]);

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

  // 左右三角按钮：按可视宽度的 70% 平滑滚动标签列表
  const scrollTabs = (dir) => {
    const el = listRef.current;
    if (el) el.scrollBy({ left: dir * Math.max(200, el.clientWidth * 0.7), behavior: 'smooth' });
  };

  const groupOf = (gid) => (groups || []).find((g) => g.id === gid) || null;
  const memberCount = (gid) => tabs.filter((t) => t.groupId === gid).length;
  // 有效固定态：标签自身被固定，或所在分组被固定（整组常驻）
  const isPinnedTab = (t) => !!(t.pinned || (t.groupId && (groupOf(t.groupId) || {}).pinned));

  // 单个标签渲染（组内/组外通用，组色由容器 CSS 变量接管；固定标签显示 pin 图标、隐藏关闭按钮）
  const renderTab = (tab, pinned) => {
    const isReq = !tab.kind || tab.kind === 'request';
    const meta = isReq ? null : tabMeta(tab);
    const active = tab.id === activeTabId;
    const dirty = isReq && isTabDirty && isTabDirty(tab);
    return (
      <div
        key={tab.id}
        data-tab-id={tab.id}
        className={`tab-item ${active ? 'active' : ''} ${tab.groupId ? 'in-group' : ''} ${pinned ? 'pinned' : ''}`}
        title={pinned ? `已固定：${isReq ? (tab.request.url || tab.request.name) : meta.title}\n右键取消固定` : (isReq ? (tab.request.url || tab.request.name) : meta.title)}
        onClick={() => onSelect(tab.id)}
        onContextMenu={(e) => openMenu(e, { type: 'tab', tabId: tab.id })}
      >
        {pinned && <JbIcon name="pin" size={12} className="tab-pin" />}
        {isReq ? (
          <span className={`method method-${tab.request.method}`}>{tab.request.method}</span>
        ) : (
          <JbIcon name={meta.icon} size={14} className="tab-icon" />
        )}
        <span className="tab-name">{isReq ? (tab.request.name || '未命名请求') : meta.label}</span>
        {isReq && tab.sending && <span className="tab-sending" title="发送中" />}
        {dirty && !tab.sending && <span className="tab-dirty" title="有未保存的修改 (Ctrl+S 保存)" />}
        {!pinned && (
          <span
            className="tab-close"
            title="关闭标签页 (Ctrl+W)"
            onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
          ><JbIcon name="close" size={12} /></span>
        )}
      </div>
    );
  };

  // 按顺序渲染：同组连续标签包进带组色底条的容器；折叠的分组只保留组牌（弹簧动画收合）
  const buildItems = (list) => {
    const out = [];
    let i = 0;
    while (i < list.length) {
      const tab = list[i];
      const group = tab.groupId ? groupOf(tab.groupId) : null;
      if (!group) {
        out.push(renderTab(tab, isPinnedTab(tab)));
        i++;
        continue;
      }
      const members = [];
      while (i < list.length && list[i].groupId === group.id) {
        members.push(list[i]);
        i++;
      }
      out.push(
        <motion.div
          key={'grp-' + group.id}
          data-group-id={group.id}
          className={`tab-group ${group.collapsed ? 'collapsed' : ''} ${group.pinned ? 'is-pinned' : ''}`}
          style={{ '--group-color': group.color }}
          layout
          {...tabIn}
          transition={{ type: 'spring', stiffness: 420, damping: 34 }}
        >
          <div
            className="tab-group-chip"
            title={`分组「${group.name}」（${members.length} 个标签）${group.pinned ? '· 已固定' : ''}\n单击折叠/展开，右键管理分组`}
            onClick={() => onToggleGroupCollapse(group.id)}
            onContextMenu={(e) => openMenu(e, { type: 'group', groupId: group.id })}
          >
            <JbIcon name={group.collapsed ? 'chevron-right' : 'chevron-down'} size={12} className="tab-group-caret" />
            {group.pinned && <JbIcon name="pin" size={11} className="tab-pin tab-pin-light" />}
            <span className="tab-group-name">{group.name}</span>
            <span className="tab-group-count">{members.length}</span>
          </div>
          {/* 成员区折叠/展开走弹簧宽度动画，收起时只留组牌 */}
          <AnimatePresence initial={false}>
            {!group.collapsed && (
              <motion.div
                className="tab-group-members"
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 'auto', opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              >
                {members.map((t) => renderTab(t, isPinnedTab(t)))}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      );
    }
    return out;
  };

  // 固定区（常驻左侧）与滚动区按有效固定态拆分
  const pinnedItems = buildItems(tabs.filter(isPinnedTab));
  const items = buildItems(tabs.filter((t) => !isPinnedTab(t)));

  const menuTab = menu && menu.type === 'tab' ? tabs.find((t) => t.id === menu.tabId) : null;
  const menuGroup = menu && menu.type === 'group' ? groupOf(menu.groupId) : null;

  return (
    <div className="tab-bar">
      {pinnedItems.length > 0 && (
        <div className="tab-pinned" aria-label="已固定的标签">
          {pinnedItems}
        </div>
      )}
      <button
        className={`tab-scroll-btn ${fadeL ? '' : 'is-hidden'}`}
        title="向左滚动标签"
        aria-label="向左滚动标签"
        onClick={() => scrollTabs(-1)}
      ><JbIcon name="chevron-left" size={14} /></button>
      <div className="tab-list-wrap">
        {fadeL && <span className="tab-fade tab-fade-l" aria-hidden="true" />}
        <div className="tab-list" ref={listRef}>
          {items}
        </div>
        {fadeR && <span className="tab-fade tab-fade-r" aria-hidden="true" />}
      </div>
      <button
        className={`tab-scroll-btn ${fadeR ? '' : 'is-hidden'}`}
        title="向右滚动标签"
        aria-label="向右滚动标签"
        onClick={() => scrollTabs(1)}
      ><JbIcon name="chevron-right" size={14} /></button>
      <button
        className="tab-add"
        title="新建标签页 (Ctrl+T 新建请求)"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setMenu({ type: 'add', x: Math.min(rect.left, window.innerWidth - 200), y: rect.bottom + 4 });
        }}
      ><JbIcon name="add" size={14} /></button>
      {/* 标签溢出时提供全部标签下拉，快速定位被挤出可视区的标签 */}
      {overflowing && (
        <button
          className="tab-all-btn"
          title={`全部标签（${tabs.length}）`}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setMenu({ type: 'all', x: Math.min(rect.left, window.innerWidth - 240), y: rect.bottom + 4 });
          }}
        >
          <JbIcon name="chevron-down" size={14} />
        </button>
      )}

      {menu && menu.type === 'add' && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <div className="ctx-item" onClick={() => { onNew(); setMenu(null); }}>HTTP 请求</div>
          <div className="ctx-item" onClick={() => { onNewWs(); setMenu(null); }}>WebSocket 连接</div>
          <div className="ctx-item" onClick={() => { onNewSse(); setMenu(null); }}>SSE 连接</div>
        </div>
      )}

      {menu && menu.type === 'all' && (
        <div className="ctx-menu tab-all-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          {tabs.map((t) => {
            const isReq = !t.kind || t.kind === 'request';
            const meta = isReq ? null : tabMeta(t);
            const g = t.groupId ? groupOf(t.groupId) : null;
            return (
              <div
                key={t.id}
                className={`ctx-item ${t.id === activeTabId ? 'ctx-item-active' : ''}`}
                onClick={() => { onSelect(t.id); setMenu(null); }}
              >
                {isReq
                  ? <span className={`method method-${t.request.method}`}>{t.request.method}</span>
                  : <JbIcon name={meta.icon} size={14} className="tab-icon" />}
                <span className="ctx-label">{isReq ? (t.request.name || '未命名请求') : meta.label}</span>
                {g && <span className="ctx-dot" style={{ background: g.color }} title={`分组「${g.name}」`} />}
              </div>
            );
          })}
        </div>
      )}

      {menuTab && (
        <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
          <div
            className="ctx-item"
            onClick={() => {
              const g = menuTab.groupId ? groupOf(menuTab.groupId) : null;
              if (g && g.pinned) onTogglePinGroup(g.id);
              else onTogglePinTab(menuTab.id);
              setMenu(null);
            }}
          >{isPinnedTab(menuTab) ? '取消固定' : '固定标签'}</div>
          <div className="ctx-sep" />
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
          <div className="ctx-item ctx-danger" onClick={() => { onCloseToRight(menuTab.id); setMenu(null); }}>关闭右侧所有标签</div>
          <div className="ctx-item ctx-danger" onClick={() => { onCloseToLeft(menuTab.id); setMenu(null); }}>关闭左侧所有标签</div>
          <div className="ctx-sep" />
          <div className="ctx-item ctx-danger" onClick={() => { onCloseAll(); setMenu(null); }}>关闭所有标签</div>
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
          <div className="ctx-item" onClick={() => { onTogglePinGroup(menuGroup.id); setMenu(null); }}>
            {menuGroup.pinned ? '取消固定分组' : '固定分组'}
          </div>
          <div className="ctx-item" onClick={() => { onUngroup(menuGroup.id); setMenu(null); }}>取消分组（保留标签）</div>
          <div className="ctx-sep" />
          <div className="ctx-item ctx-danger" onClick={() => { onCloseGroup(menuGroup.id); setMenu(null); }}>关闭分组内所有标签</div>
        </div>
      )}
    </div>
  );
}
