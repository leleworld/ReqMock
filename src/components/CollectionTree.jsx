import React, { useState } from 'react';
import { countRequests } from '../utils/collectionUtil.js';
import { JbIcon } from './Icons.jsx';

// 拖拽自定义 MIME：与文件拖入导入（Files）区分，仅树内请求移动响应
const DRAG_MIME = 'application/x-reqmock-request';
const hasReqDrag = (e) => Array.from(e.dataTransfer.types || []).includes(DRAG_MIME);

/**
 * 集合树：集合 > 嵌套文件夹 > 请求，支持按关键字过滤（filter）
 * 过滤范围：集合/文件夹名称、请求名称、请求 URL、请求方法（GET/POST 等）
 * 请求行可拖拽：拖到另一请求上插入到其前，拖到集合/文件夹行上移入末尾
 */
export default function CollectionTree(props) {
  const { collections, filter, onNewRequest, onNewCollection, onImport } = props;
  const q = (filter || '').trim().toLowerCase();
  const shown = q ? collections.map((c) => filterNode(c, q)).filter(Boolean) : collections;
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
        <CollectionNode key={col.id} {...props} collection={col} forceOpen={!!q} />
      ))}
    </div>
  );
}

/** 节点名命中时保留整棵子树；否则递归过滤子文件夹与请求（按名称/URL/方法），全空则剔除 */
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
  const { collection, forceOpen, onCollectionSettings, onExportCollection, onDeleteCollection, onAddFolder, onOpenRunner, onMoveRequest } = props;
  const [open, setOpen] = useState(true);
  const [dropOver, setDropOver] = useState(false);
  const isOpen = open || forceOpen;

  return (
    <div className="tree-collection">
      <div
        className={`tree-row tree-collection-row ${dropOver ? 'drop-into' : ''}`}
        onClick={() => setOpen(!open)}
        onDragOver={(e) => { if (hasReqDrag(e)) { e.preventDefault(); e.stopPropagation(); setDropOver(true); } }}
        onDragLeave={() => setDropOver(false)}
        onDrop={(e) => {
          if (!hasReqDrag(e)) return;
          e.preventDefault(); e.stopPropagation(); setDropOver(false);
          const id = e.dataTransfer.getData(DRAG_MIME);
          if (id && onMoveRequest) onMoveRequest(id, collection.id);
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
  const { folder, depth, forceOpen, onAddFolder, onRenameNode, onDeleteFolder, onOpenRunner, onMoveRequest } = props;
  const [open, setOpen] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const isOpen = open || forceOpen;

  return (
    <div className="tree-folder">
      <div
        className={`tree-row ${dropOver ? 'drop-into' : ''}`}
        style={{ paddingLeft: depth * 14 }}
        onClick={() => setOpen(!open)}
        onDragOver={(e) => { if (hasReqDrag(e)) { e.preventDefault(); e.stopPropagation(); setDropOver(true); } }}
        onDragLeave={() => setDropOver(false)}
        onDrop={(e) => {
          if (!hasReqDrag(e)) return;
          e.preventDefault(); e.stopPropagation(); setDropOver(false);
          const id = e.dataTransfer.getData(DRAG_MIME);
          if (id && onMoveRequest) onMoveRequest(id, folder.id);
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
  const { node, depth, activeRequestId, onOpenRequest, onDeleteRequest, onMoveRequest } = props;
  const folders = node.folders || [];
  const requests = node.requests || [];
  // 拖拽悬停的目标请求 id：行顶部展示插入指示线
  const [overReqId, setOverReqId] = useState(null);

  return (
    <>
      {folders.map((f) => (
        <FolderNode key={f.id} {...props} folder={f} depth={depth} />
      ))}
      {requests.map((req) => (
        <div
          key={req.id}
          className={`tree-row tree-request ${req.id === activeRequestId ? 'selected' : ''} ${overReqId === req.id ? 'drop-before' : ''}`}
          style={{ paddingLeft: depth * 14 + 14 }}
          onClick={() => onOpenRequest(req)}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(DRAG_MIME, req.id);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onDragOver={(e) => {
            if (hasReqDrag(e)) { e.preventDefault(); e.stopPropagation(); setOverReqId(req.id); }
          }}
          onDragLeave={() => setOverReqId((cur) => (cur === req.id ? null : cur))}
          onDrop={(e) => {
            if (!hasReqDrag(e)) return;
            e.preventDefault(); e.stopPropagation(); setOverReqId(null);
            const id = e.dataTransfer.getData(DRAG_MIME);
            if (id && id !== req.id && onMoveRequest) onMoveRequest(id, node.id, req.id);
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
      ))}
      {folders.length === 0 && requests.length === 0 && (
        <div
          className="empty-hint"
          style={{ paddingLeft: depth * 14 + 14 }}
          onDragOver={(e) => { if (hasReqDrag(e)) { e.preventDefault(); e.stopPropagation(); } }}
          onDrop={(e) => {
            if (!hasReqDrag(e)) return;
            e.preventDefault(); e.stopPropagation();
            const id = e.dataTransfer.getData(DRAG_MIME);
            if (id && onMoveRequest) onMoveRequest(id, node.id);
          }}
        >空（可拖入请求）</div>
      )}
    </>
  );
}
