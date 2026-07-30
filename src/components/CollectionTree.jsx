import React, { useState } from 'react';
import { countRequests } from '../utils/collectionUtil.js';

/**
 * 集合树：集合 > 嵌套文件夹 > 请求，支持按关键字过滤（filter）
 */
export default function CollectionTree(props) {
  const { collections, filter } = props;
  const q = (filter || '').trim().toLowerCase();
  const shown = q ? collections.map((c) => filterNode(c, q)).filter(Boolean) : collections;
  return (
    <div className="collection-tree">
      {collections.length === 0 && <div className="empty-hint">暂无集合，点击上方"新建集合"</div>}
      {q && collections.length > 0 && shown.length === 0 && <div className="empty-hint">无匹配结果</div>}
      {shown.map((col) => (
        <CollectionNode key={col.id} {...props} collection={col} forceOpen={!!q} />
      ))}
    </div>
  );
}

/** 节点名命中时保留整棵子树；否则递归过滤子文件夹与请求（按名称/URL），全空则剔除 */
function filterNode(node, q) {
  if ((node.name || '').toLowerCase().includes(q)) return node;
  const folders = (node.folders || []).map((f) => filterNode(f, q)).filter(Boolean);
  const requests = (node.requests || []).filter(
    (r) => (r.name || '').toLowerCase().includes(q) || (r.url || '').toLowerCase().includes(q)
  );
  if (folders.length === 0 && requests.length === 0) return null;
  return { ...node, folders, requests };
}

function CollectionNode(props) {
  const { collection, forceOpen, onCollectionSettings, onExportCollection, onDeleteCollection, onAddFolder, onOpenRunner } = props;
  const [open, setOpen] = useState(true);
  const isOpen = open || forceOpen;

  return (
    <div className="tree-collection">
      <div className="tree-row tree-collection-row" onClick={() => setOpen(!open)}>
        <span className="tree-arrow">{isOpen ? '▾' : '▸'}</span>
        <span className="item-name" title={collection.doc || collection.name}>{collection.name}</span>
        <span className="tree-count">{countRequests(collection)}</span>
        <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
          <span className="tree-action" title="批量运行（Collection Runner）" onClick={() => onOpenRunner(collection.id)}>▶</span>
          <span className="tree-action" title="新建文件夹" onClick={() => onAddFolder(collection.id)}>＋</span>
          <span className="tree-action" title="设置" onClick={() => onCollectionSettings(collection.id)}>⚙</span>
          <span className="tree-action" title="导出该集合" onClick={() => onExportCollection(collection.id)}>↥</span>
          <span className="tree-action tree-action-danger" title="删除集合" onClick={() => onDeleteCollection(collection.id)}>×</span>
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
  const { folder, depth, forceOpen, onAddFolder, onRenameNode, onDeleteFolder, onOpenRunner } = props;
  const [open, setOpen] = useState(false);
  const isOpen = open || forceOpen;

  return (
    <div className="tree-folder">
      <div className="tree-row" style={{ paddingLeft: depth * 14 }} onClick={() => setOpen(!open)}>
        <span className="tree-arrow">{isOpen ? '▾' : '▸'}</span>
        <span className="tree-folder-icon">🗀</span>
        <span className="item-name" title={folder.name}>{folder.name}</span>
        <span className="tree-count">{countRequests(folder)}</span>
        <span className="tree-actions" onClick={(e) => e.stopPropagation()}>
          <span className="tree-action" title="批量运行（Collection Runner）" onClick={() => onOpenRunner(folder.id)}>▶</span>
          <span className="tree-action" title="新建子文件夹" onClick={() => onAddFolder(folder.id)}>＋</span>
          <span className="tree-action" title="重命名" onClick={() => onRenameNode(folder.id, folder.name)}>✎</span>
          <span className="tree-action tree-action-danger" title="删除文件夹" onClick={() => onDeleteFolder(folder.id)}>×</span>
        </span>
      </div>
      {isOpen && <NodeBody {...props} node={folder} depth={depth + 1} />}
    </div>
  );
}

/** 渲染某节点下的子文件夹与请求 */
function NodeBody(props) {
  const { node, depth, activeRequestId, onOpenRequest, onDeleteRequest } = props;
  const folders = node.folders || [];
  const requests = node.requests || [];

  return (
    <>
      {folders.map((f) => (
        <FolderNode key={f.id} {...props} folder={f} depth={depth} />
      ))}
      {requests.map((req) => (
        <div
          key={req.id}
          className={`tree-row tree-request ${req.id === activeRequestId ? 'selected' : ''}`}
          style={{ paddingLeft: depth * 14 + 14 }}
          onClick={() => onOpenRequest(req)}
        >
          <span className={`method method-${req.method}`}>{req.method}</span>
          <span className="item-name" title={req.url}>{req.name}</span>
          <span className="tree-actions">
            <span
              className="tree-action tree-action-danger"
              title="删除请求"
              onClick={(e) => { e.stopPropagation(); onDeleteRequest(req.id); }}
            >×</span>
          </span>
        </div>
      ))}
      {folders.length === 0 && requests.length === 0 && (
        <div className="empty-hint" style={{ paddingLeft: depth * 14 + 14 }}>空</div>
      )}
    </>
  );
}
