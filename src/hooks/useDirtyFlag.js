/**
 * useDirtyFlag — 标签页脏标记 hook
 *
 * 用 dirty flag 替代 JSON.stringify 全量序列化对比，
 * 在 patchTab 修改请求内容时标记 dirty = true，
 * 保存成功后通过 markTabClean(tabId) 清除标记。
 *
 * 对于从未入集合的新请求，只要不是空白请求就视为 dirty。
 */
import { useCallback, useRef } from 'react';

/**
 * @param {Function} isBlankRequest - 判断请求是否为空白（未编辑过）
 * @returns {{ isTabDirty, markTabDirty, markTabClean, patchTabWithDirty }}
 */
export function useDirtyFlag(isBlankRequest) {
  // 存储每个 tabId 对应的脏标记：true 表示有未保存改动
  const dirtyMapRef = useRef(new Map());

  /**
   * 判断标签页是否有未保存改动
   * - 有 dirty 标记 → true
   * - 无标记且为非空白未入集合请求 → true（首次打开已有内容的请求）
   * - 其余 → false
   *
   * 注意：对于从集合中打开的请求，打开时 dirty 默认 false，
   * 只有实际修改后（patchTabWithDirty）才变为 true
   */
  const isTabDirty = useCallback((tab) => {
    if (!tab || tab.kind !== 'request') return false;

    const flag = dirtyMapRef.current.get(tab.id);
    // 已显式标记
    if (flag === true) return true;
    if (flag === false) return false;

    // 未显式标记（新建的标签页还没有触发过 patchTabWithDirty）：
    // 非空白请求且没有被保存过 → 视为 dirty
    // 这里用 savedId 字段判断是否已入集合（由 openRequest/saveRequest 设置）
    if (tab._savedId) return false; // 从集合打开但未修改
    return !isBlankRequest(tab.request);
  }, [isBlankRequest]);

  /** 标记标签为脏 */
  const markTabDirty = useCallback((tabId) => {
    dirtyMapRef.current.set(tabId, true);
  }, []);

  /** 清除脏标记（保存成功后调用） */
  const markTabClean = useCallback((tabId) => {
    dirtyMapRef.current.set(tabId, false);
  }, []);

  /** 批量清除（标签关闭时释放内存） */
  const removeDirtyEntry = useCallback((tabId) => {
    dirtyMapRef.current.delete(tabId);
  }, []);

  /**
   * 增强版 patchTab：当 patch 中包含 request 字段时自动标记 dirty
   * 用法：在 App 中替换原 patchTab，内部调用 setTabs
   *
   * @param {Function} setTabs - React setState for tabs
   * @returns {Function} patchTabWithDirty(tabId, patch)
   */
  const makePatchTabWithDirty = useCallback((setTabs) => {
    return (tabId, patch) => {
      // 如果 patch 里有 request 说明用户在编辑请求内容 → 标脏
      if (patch.request !== undefined) {
        dirtyMapRef.current.set(tabId, true);
      }
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...patch } : t)));
    };
  }, []);

  return {
    isTabDirty,
    markTabDirty,
    markTabClean,
    removeDirtyEntry,
    makePatchTabWithDirty
  };
}
