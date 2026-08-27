import React, { useState, useRef, useEffect, useCallback } from 'react';
import { countRequests, findRequestAncestorIds } from '../utils/collectionUtil.js';
import { JbIcon } from './Icons.jsx';

// 拖拽自定义 MIME：与文件拖入导入（Files）区分，仅树内移动响应
const DRAG_MIME_REQUEST = 'application/x-reqmock-request';
const DRAG_MIME_FOLDER = 'application/x-reqmock-folder';
const hasTreeDrag = (e) => {
  const types = Array.from(e.dataTransfer.types || []);
  return types.includes(DRAG_MIME_REQUEST) || types.includes(DRAG_MIME_FOLDER);
};
const hasReqDrag = (e) => Array.from(e.dataTransfer.types || []).includes(DRAG_MIME_REQUEST);
const hasFolderDrag = (e) => Array.from(e.dataTransfer.types || []).includes(DRAG_MIME_FOLDER);

/** 判断拖入位置：上 1/4 = before, 下 1/4 = after, 中间 = into */
function getDropZone(e, el) {
  const rect = el.getBoundingClientRect();
  const y = e.clientY - rect.top;
  const h = rect.height;
  if (y < h * 0.25) return 'before';
  if (y > h * 0.75) return 'after';
  return 'into';
}

/** 判断拖入位置（仅上/下）：上半 = before, 下半 = after */
function getDropZoneHalf(e, el) {
  const rect = el.getBoundingClientRect();
  const y = e.clientY - rect.top;
  return y < rect.height * 0.5 ? 'before' : 'after';
}

/**
 * 集合树：集合 > 嵌套文件夹 > 请求，支持按关键字过滤（filter）
 * 过滤范围：集合/文件夹名称、请求名称、请求 URL、请求方法（GET/POST 等）
 * 支持拖拽排序：请求之间排序、文件夹之间排序、请求拖入/拖出文件夹、悬停自动展开
 */
export default function CollectionTree(props) {
  const { collections, filter, onNewRequest, onNewCollection, onImport,
    onRenameNode, onDeleteCollection, onDeleteFolder, onDeleteRequest,
    onExportCollection, onAddFolder, onDuplicateNode, onDuplicateRequest,
    onCopyAsCurl, onMoveToNode
  } = props;
  const q = (filter || '').trim().toLowerCase();
  const shown = q ? collections.map((c) => filterNode(c, q)).filter(Boolean) : collections;

  // ===== 定位当前请求：reveal = { reqId, tick }，tick 递增即触发一次定位 =====
  // 被强制展开过的祖先记在这里，定位后保持展开状态（不随下次定位收回，避免树来回跳）
  const [forceOpenIds, setForceOpenIds] = useState(() => new Set());
  const revealTick = props.reveal && props.reveal.tick;
  useEffect(() => {
    const reqId = props.reveal && props.reveal.reqId;
    if (!reqId || !revealTick) return;
    const ids = findRequestAncestorIds(collections, reqId);
    if (!ids) return; // 未保存到集合：由按钮侧提示，这里不动树
    setForceOpenIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    // 等展开与（可能的）清空过滤重渲染落地后再滚动
    const timer = setTimeout(() => {
      const row = document.querySelector(`.tree-request[data-request-id="${reqId}"]`);
      const box = row && row.closest('.side-panel-body');
      if (!row) return;
      if (box) {
        const rr = row.getBoundingClientRect();
        const rb = box.getBoundingClientRect();
        if (rr.top < rb.top) box.scrollTop -= rb.top - rr.top + 8;
        else if (rr.bottom > rb.bottom) box.scrollTop += rr.bottom - rb.bottom + 8;
      }
      row.classList.add('tree-reveal');
      setTimeout(() => row.classList.remove('tree-reveal'), 1200);
    }, 60);
    return () => clearTimeout(timer);
  }, [revealTick]);

  // ===== 右键上下文菜单状态 =====
  const [ctxMenu, setCtxMenu] = useState(null); // { x, y, nodeType, nodeId, nodeName, collectionId }

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  // 点击外部关闭
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = () => closeCtxMenu();
    document.addEventListener('click', handler);
    document.addEventListener('contextmenu', handler);
    return () => {
      document.removeEventListener('click', handler);
      document.removeEventListener('contextmenu', handler);
    };
  }, [ctxMenu, closeCtxMenu]);

  // Escape 关闭
  useEffect(() => {
    if (!ctxMenu) return;
    const handler = (e) => { if (e.key === 'Escape') closeCtxMenu(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [ctxMenu, closeCtxMenu]);

  const handleContextMenu = useCallback((e, nodeType, nodeId, nodeName, collectionId) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, nodeType, nodeId, nodeName, collectionId });
  }, []);

  // 菜单操作处理
  const handleMenuAction = useCallback((action) => {
    if (!ctxMenu) return;
    const { nodeType, nodeId, nodeName, collectionId } = ctxMenu;
    closeCtxMenu();
    switch (action) {
      case 'newRequest':
        if (onNewRequest) onNewRequest(nodeId);
        break;
      case 'newFolder':
      case 'newSubFolder':
        if (onAddFolder) onAddFolder(nodeId);
        break;
      case 'rename':
        if (onRenameNode) onRenameNode(nodeId, nodeName);
        break;
      case 'duplicate':
        if (onDuplicateNode) onDuplicateNode(nodeId);
        break;
      case 'duplicateRequest':
        if (onDuplicateRequest) onDuplicateRequest(nodeId);
        else if (onDuplicateNode) onDuplicateNode(nodeId);
        break;
      case 'copyAsCurl':
        if (onCopyAsCurl) onCopyAsCurl(nodeId);
        break;
      case 'exportCollection':
        if (onExportCollection) onExportCollection(nodeId);
        break;
      case 'moveTo':
        if (onMoveToNode) onMoveToNode(nodeId);
        break;
      case 'deleteCollection':
        if (onDeleteCollection) onDeleteCollection(nodeId);
        break;
      case 'deleteFolder':
        if (onDeleteFolder) onDeleteFolder(nodeId);
        break;
      case 'deleteRequest':
        if (onDeleteRequest) onDeleteRequest(nodeId);
        break;
      default:
        break;
    }
  }, [ctxMenu, closeCtxMenu, onNewRequest, onAddFolder, onRenameNode, onDuplicateNode, onDuplicateRequest, onCopyAsCurl, onExportCollection, onMoveToNode, onDeleteCollection, onDeleteFolder, onDeleteRequest]);

  return (
    <div className="collection-tree">
      {collections.length === 0 && (
        <div className="empty-guide">
          <div className="empty-guide-title">还没有集合</div>
          <div className="empty-guide-desc">集合用于归类保存请求，支持公共 Headers / 授权 / 批量运行</div>
          <button className="btn-block" onClick={onNewCollection}>+ 新建集合</button>
          <button className="btn-block" onClick={onNewRequest}>+ 新建请求</button>
          <button className="btn-block" title="支持 ReqMock / Reqable / Postman / Hoppscotch / OpenAPI / Insomnia / HAR" onClick={onImport}>导入…（也可直接拖文件到窗口）</button>
        </div>
      )}
      {q && collections.length > 0 && shown.length === 0 && <div className="empty-hint">无匹配结果</div>}
      {shown.map((col) => (
        <CollectionNode key={col.id} {...props} collection={col} forceOpen={!!q} forceOpenIds={forceOpenIds} onContextMenu={handleContextMenu} />
      ))}

      {/* 右键上下文菜单 */}
      {ctxMenu && <ContextMenu ctxMenu={ctxMenu} onAction={handleMenuAction} onClose={closeCtxMenu} />}
    </div>
  );
}

/** 节点命中时保留整棵子树；否则递归过滤子文件夹与请求（按名称/URL/方法），全空则剔除 */
function filterNode(node, q) {
  if ((node.name || '').toLowerCase().includes(q)) return node;
  const folders = (node.folders || []).map((f) => filterNode(f, q)).filter(Boolean);
  const requests = (node.requests || []).filter(
    (r) => (r.name || '').toLowerCase().includes(q) ||
           (r.url || '').toLowerCase().includes(q) ||
           (r.method || '').toLowerCase().includes(q)
  );
  if (folders.length === 0 && requests.length === 0) return null;
  return { ...node, folders, requests };
}

function CollectionNode(props) {
  const { collection, forceOpen, forceOpenIds, onCollectionSettings, onExportCollection, onDeleteCollection, onAddFolder, onOpenRunner, onMoveRequest, onMoveFolder, onContextMenu } = props;
  const [open, setOpen] = useState(true);
  const [dropState, setDropState] = useState(null); // 'into' | 'before' | 'after'
  const rowRef = useRef(null);
  const expandTimer = useRef(null);
  const isOpen = open || forceOpen;

  // 定位时把本节点自身展开态打开（一次性），之后仍可正常手动折叠
  useEffect(() => {
    if (forceOpenIds && forceOpenIds.has(collection.id)) setOpen(true);
  }, [forceOpenIds]);

  const clearExpand = () => { if (expandTimer.current) { clearTimeout(expandTimer.current); expandTimer.current = null; } };

  return (
    <div className="tree-collection">
      <div
        ref={rowRef}
        className={`tree-row tree-collection-row${dropState === 'into' ? ' drop-into' : ''}${dropState === 'before' ? ' drop-before' : ''}${dropState === 'after' ? ' drop-after' : ''}`}
        onClick={() => setOpen(!open)}
        onContextMenu={(e) => {
          if (onContextMenu) onContextMenu(e, 'collection', collection.id, collection.name, collection.id);
        }}
        onDragOver={(e) => {
          if (!hasTreeDrag(e)) return;
          e.preventDefault(); e.stopPropagation();
          // 文件夹拖拽可以有 before/after/into；请求拖拽只有 into
          if (hasFolderDrag(e)) {
            setDropState(getDropZone(e, rowRef.current));
          } else {
            setDropState('into');
          }
          // 悬停 >500ms 自动展开
          if (!isOpen && !expandTimer.current) {
            expandTimer.current = setTimeout(() => { setOpen(true); expandTimer.current = null; }, 500);
          }
        }}
        onDragLeave={(e) => {
          // 只在真正离开时清除（避免子元素触发）
          if (rowRef.current && !rowRef.current.contains(e.relatedTarget)) {
            setDropState(null); clearExpand();
          }
        }}
        onDrop={(e) => {
          if (!hasTreeDrag(e)) return;
          e.preventDefault(); e.stopPropagation();
          const zone = dropState;
          setDropState(null); clearExpand();
          if (hasReqDrag(e)) {
            const id = e.dataTransfer.getData(DRAG_MIME_REQUEST);
            if (id && onMoveRequest) onMoveRequest(id, collection.id);
          } else if (hasFolderDrag(e)) {
            const id = e.dataTransfer.getData(DRAG_MIME_FOLDER);
            if (id && id !== collection.id && onMoveFolder) {
              // 文件夹拖到集合行上 -> 移入该集合
              onMoveFolder(id, collection.id);
            }
          }
        }}
      >
        <JbIcon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} className="tree-arrow" />
        <span className="item-name" title={collection.doc || collection.name}>{collection.name}</span>
        <span className="tree-count">{countRequests(collection)}</span>
        <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
          <span className="tree-action" title="批量运行（Collection Runner）" onClick={() => onOpenRunner(collection.id)}><JbIcon name="play" size={14} /></span>
          <span className="tree-action" title="新建文件夹" onClick={() => onAddFolder(collection.id)}><JbIcon name="add" size={14} /></span>
          <span className="tree-action" title="设置" onClick={() => onCollectionSettings(collection.id)}><JbIcon name="settings" size={14} /></span>
          <span className="tree-action" title="导出该集合" onClick={() => onExportCollection(collection.id)}><JbIcon name="export" size={14} /></span>
          <span className="tree-action tree-action-danger" title="删除集合" onClick={() => onDeleteCollection(collection.id)}><JbIcon name="trash" size={14} /></span>
        </span>
      </div>
      {isOpen && (
        <div className="tree-children">
          <NodeBody {...props} node={collection} depth={1} />
        </div>
      )}
    </div>
  );
}

function FolderNode(props) {
  const { folder, node: parentNode, depth, forceOpen, forceOpenIds, onAddFolder, onRenameNode, onDeleteFolder, onOpenRunner, onMoveRequest, onMoveFolder, onContextMenu } = props;
  const [open, setOpen] = useState(false);
  const [dropState, setDropState] = useState(null); // 'into' | 'before' | 'after'
  const [dragging, setDragging] = useState(false);
  const rowRef = useRef(null);
  const expandTimer = useRef(null);
  const isOpen = open || forceOpen;

  // 定位时把本文件夹自身展开态打开（一次性），之后仍可正常手动折叠
  useEffect(() => {
    if (forceOpenIds && forceOpenIds.has(folder.id)) setOpen(true);
  }, [forceOpenIds]);

  const clearExpand = () => { if (expandTimer.current) { clearTimeout(expandTimer.current); expandTimer.current = null; } };

  return (
    <div className={`tree-folder${dragging ? ' dragging' : ''}`}>
      <div
        ref={rowRef}
        className={`tree-row tree-folder-row${dropState === 'into' ? ' drop-into' : ''}${dropState === 'before' ? ' drop-before' : ''}${dropState === 'after' ? ' drop-after' : ''}`}
        style={{ paddingLeft: depth * 14 }}
        onClick={() => setOpen(!open)}
        draggable
        onContextMenu={(e) => {
          if (onContextMenu) onContextMenu(e, 'folder', folder.id, folder.name, null);
        }}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_MIME_FOLDER, folder.id);
          e.dataTransfer.effectAllowed = 'move';
          // 延迟设置 dragging 状态避免立即隐藏影响拖拽预览
          requestAnimationFrame(() => setDragging(true));
        }}
        onDragEnd={() => { setDragging(false); }}
        onDragOver={(e) => {
          if (!hasTreeDrag(e)) return;
          e.preventDefault(); e.stopPropagation();
          const zone = getDropZone(e, rowRef.current);
          setDropState(zone);
          // 悬停中间区域 >500ms 自动展开
          if (zone === 'into' && !isOpen && !expandTimer.current) {
            expandTimer.current = setTimeout(() => { setOpen(true); expandTimer.current = null; }, 500);
          }
          if (zone !== 'into') clearExpand();
        }}
        onDragLeave={(e) => {
          if (rowRef.current && !rowRef.current.contains(e.relatedTarget)) {
            setDropState(null); clearExpand();
          }
        }}
        onDrop={(e) => {
          if (!hasTreeDrag(e)) return;
          e.preventDefault(); e.stopPropagation();
          const zone = dropState;
          setDropState(null); clearExpand();

          if (hasReqDrag(e)) {
            const id = e.dataTransfer.getData(DRAG_MIME_REQUEST);
            if (!id || !onMoveRequest) return;
            if (zone === 'into') {
              // 移入文件夹末尾
              onMoveRequest(id, folder.id);
            } else if (zone === 'before') {
              // 插入到该文件夹的父节点中，该文件夹位置之前（作为同级请求）
              // 这种情况比较少见，简单处理为移入父节点
              onMoveRequest(id, folder.id);
            } else {
              onMoveRequest(id, folder.id);
            }
          } else if (hasFolderDrag(e)) {
            const id = e.dataTransfer.getData(DRAG_MIME_FOLDER);
            if (!id || id === folder.id || !onMoveFolder) return;
            if (zone === 'into') {
              // 移入该文件夹内
              onMoveFolder(id, folder.id);
            } else if (zone === 'before') {
              // 在该文件夹之前插入（同级排序）
              onMoveFolder(id, parentNode.id, folder.id);
            } else {
              // 在该文件夹之后插入（同级排序）
              // 找到该文件夹在父节点中的下一个兄弟
              const siblings = parentNode.folders || [];
              const curIdx = siblings.findIndex((f) => f.id === folder.id);
              const nextSibling = curIdx >= 0 && curIdx < siblings.length - 1 ? siblings[curIdx + 1] : null;
              onMoveFolder(id, parentNode.id, nextSibling ? nextSibling.id : null);
            }
          }
        }}
      >
        <JbIcon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} className="tree-arrow" />
        <span className="tree-folder-icon"><JbIcon name="folder" size={13} /></span>
        <span className="item-name" title={folder.name}>{folder.name}</span>
        <span className="tree-count">{countRequests(folder)}</span>
        <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
          <span className="tree-action" title="批量运行（Collection Runner）" onClick={() => onOpenRunner(folder.id)}><JbIcon name="play" size={14} /></span>
          <span className="tree-action" title="新建子文件夹" onClick={() => onAddFolder(folder.id)}><JbIcon name="add" size={14} /></span>
          <span className="tree-action" title="重命名" onClick={() => onRenameNode(folder.id, folder.name)}><JbIcon name="pencil" size={14} /></span>
          <span className="tree-action tree-action-danger" title="删除文件夹" onClick={() => onDeleteFolder(folder.id)}><JbIcon name="trash" size={14} /></span>
        </span>
      </div>
      {isOpen && <NodeBody {...props} node={folder} depth={depth + 1} />}
    </div>
  );
}

/** 渲染某节点下的子文件夹与请求 */
function NodeBody(props) {
  const { node, depth, activeRequestId, onOpenRequest, onDeleteRequest, onMoveRequest, onMoveFolder, onContextMenu } = props;
  const folders = node.folders || [];
  const requests = node.requests || [];

  return (
    <>
      {folders.map((f) => (
        <FolderNode key={f.id} {...props} folder={f} depth={depth} />
      ))}
      {requests.map((req) => (
        <RequestRow
          key={req.id}
          req={req}
          node={node}
          depth={depth}
          activeRequestId={activeRequestId}
          onOpenRequest={onOpenRequest}
          onDeleteRequest={onDeleteRequest}
          onMoveRequest={onMoveRequest}
          onContextMenu={onContextMenu}
        />
      ))}
      {folders.length === 0 && requests.length === 0 && (
        <div
          className="empty-hint"
          style={{ paddingLeft: depth * 14 + 14 }}
          onDragOver={(e) => { if (hasTreeDrag(e)) { e.preventDefault(); e.stopPropagation(); } }}
          onDrop={(e) => {
            if (!hasTreeDrag(e)) return;
            e.preventDefault(); e.stopPropagation();
            if (hasReqDrag(e)) {
              const id = e.dataTransfer.getData(DRAG_MIME_REQUEST);
              if (id && onMoveRequest) onMoveRequest(id, node.id);
            } else if (hasFolderDrag(e)) {
              const id = e.dataTransfer.getData(DRAG_MIME_FOLDER);
              if (id && onMoveFolder) onMoveFolder(id, node.id);
            }
          }}
        >空（可拖入请求）</div>
      )}
    </>
  );
}

/** 单个请求行，支持拖拽排序 */
function RequestRow({ req, node, depth, activeRequestId, onOpenRequest, onDeleteRequest, onMoveRequest, onContextMenu }) {
  const [dropZone, setDropZone] = useState(null); // 'before' | 'after'
  const [dragging, setDragging] = useState(false);
  const rowRef = useRef(null);

  return (
    <div
      ref={rowRef}
      data-request-id={req.id}
      className={`tree-row tree-request${req.id === activeRequestId ? ' selected' : ''}${dropZone === 'before' ? ' drop-before' : ''}${dropZone === 'after' ? ' drop-after' : ''}${dragging ? ' dragging' : ''}`}
      style={{ paddingLeft: depth * 14 + 14 }}
      onClick={() => onOpenRequest(req)}
      draggable
      onContextMenu={(e) => {
        if (onContextMenu) onContextMenu(e, 'request', req.id, req.name, null);
      }}
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_MIME_REQUEST, req.id);
        e.dataTransfer.effectAllowed = 'move';
        requestAnimationFrame(() => setDragging(true));
      }}
      onDragEnd={() => { setDragging(false); }}
      onDragOver={(e) => {
        if (!hasReqDrag(e)) return;
        e.preventDefault(); e.stopPropagation();
        setDropZone(getDropZoneHalf(e, rowRef.current));
      }}
      onDragLeave={(e) => {
        if (rowRef.current && !rowRef.current.contains(e.relatedTarget)) {
          setDropZone(null);
        }
      }}
      onDrop={(e) => {
        if (!hasReqDrag(e)) return;
        e.preventDefault(); e.stopPropagation();
        const zone = dropZone;
        setDropZone(null);
        const id = e.dataTransfer.getData(DRAG_MIME_REQUEST);
        if (!id || id === req.id || !onMoveRequest) return;
        // 用 beforeReqId 参数：before 时传当前 req.id，after 时传下一个 req 的 id（或 null 表示末尾）
        if (zone === 'before') {
          onMoveRequest(id, node.id, req.id);
        } else {
          // after：找到当前请求在父节点中的下一个请求
          const reqs = node.requests || [];
          const curIdx = reqs.findIndex((r) => r.id === req.id);
          const nextReq = curIdx >= 0 && curIdx < reqs.length - 1 ? reqs[curIdx + 1] : null;
          onMoveRequest(id, node.id, nextReq ? nextReq.id : null);
        }
      }}
    >
      <span className={`method method-${req.method}`}>{req.method}</span>
      <span className="item-name" title={req.url}>{req.name}</span>
      <span className="tree-actions">
        <span
          className="tree-action tree-action-danger"
          title="删除请求"
          onClick={(e) => { e.stopPropagation(); onDeleteRequest(req.id); }}
        ><JbIcon name="trash" size={12} /></span>
      </span>
    </div>
  );
}

/** 右键上下文菜单组件 */
function ContextMenu({ ctxMenu, onAction, onClose }) {
  const { x, y, nodeType } = ctxMenu;
  const menuRef = useRef(null);

  // 确保菜单不超出视口
  const [pos, setPos] = useState({ left: x, top: y });
  useEffect(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (x + rect.width > vw) left = vw - rect.width - 4;
    if (y + rect.height > vh) top = vh - rect.height - 4;
    if (left < 0) left = 4;
    if (top < 0) top = 4;
    setPos({ left, top });
  }, [x, y]);

  const items = getMenuItems(nodeType);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      style={{ left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <div key={`sep-${i}`} className="context-menu-separator" />
        ) : (
          <div
            key={item.action}
            className={`context-menu-item${item.danger ? ' context-menu-item-danger' : ''}`}
            onClick={() => onAction(item.action)}
          >
            {item.label}
          </div>
        )
      )}
    </div>
  );
}

/** 根据节点类型返回菜单项列表 */
function getMenuItems(nodeType) {
  switch (nodeType) {
    case 'collection':
      return [
        { label: '新建请求', action: 'newRequest' },
        { label: '新建文件夹', action: 'newFolder' },
        { separator: true },
        { label: '重命名', action: 'rename' },
        { label: '复制', action: 'duplicate' },
        { separator: true },
        { label: '导出集合', action: 'exportCollection' },
        { separator: true },
        { label: '删除集合', action: 'deleteCollection', danger: true },
      ];
    case 'folder':
      return [
        { label: '新建请求', action: 'newRequest' },
        { label: '新建子文件夹', action: 'newSubFolder' },
        { separator: true },
        { label: '重命名', action: 'rename' },
        { label: '移动到…', action: 'moveTo' },
        { separator: true },
        { label: '删除', action: 'deleteFolder', danger: true },
      ];
    case 'request':
      return [
        { label: '复制请求', action: 'duplicateRequest' },
        { label: '复制为 cURL', action: 'copyAsCurl' },
        { separator: true },
        { label: '重命名', action: 'rename' },
        { label: '移动到…', action: 'moveTo' },
        { separator: true },
        { label: '删除', action: 'deleteRequest', danger: true },
      ];
    default:
      return [];
  }
}
