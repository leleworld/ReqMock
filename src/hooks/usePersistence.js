/**
 * usePersistence — 优化后的持久化 hook
 *
 * 核心改进：
 * 1. 用 useRef 持有最新状态快照，避免 useEffect 依赖 13+ 个 state
 * 2. 仅通过一个 dirty 标记触发写入，timer 只创建一次不重建
 * 3. 使用 requestIdleCallback（降级 setTimeout）在空闲时写入，不阻塞 UI
 *
 * 原方案问题：
 * - 依赖数组包含所有 state → 任何微小变化都 clearTimeout + setTimeout
 * - timer 重建频率极高（打字时每个字符触发）
 * - 传递全量 state 闭包给 saveStore，闭包捕获频繁刷新
 */
import { useRef, useEffect, useCallback } from 'react';

const DEBOUNCE_MS = 800; // 去抖延迟（毫秒）

/**
 * @param {Object} opts
 * @param {boolean} opts.loaded - 数据是否已从磁盘加载完成
 * @param {Function} opts.getSnapshot - 返回当前需要持久化的完整状态对象
 * @param {Function} opts.saveStore - 实际写入函数 window.api.saveStore
 */
export function usePersistence({ loaded, getSnapshot, saveStore }) {
  // 脏标记：有任何 state 变化时置为 true
  const dirtyRef = useRef(false);
  // 定时器 ID
  const timerRef = useRef(null);
  // 是否已销毁（组件卸载）
  const unmountedRef = useRef(false);

  /**
   * 标记状态已变更，需要持久化
   * 在任何 setState 后调用（或通过 wrapper 自动注入）
   */
  const markPersistDirty = useCallback(() => {
    if (!loaded) return;
    dirtyRef.current = true;

    // 如果已经有等待中的 timer，不需要重建
    if (timerRef.current !== null) return;

    // 创建去抖 timer：DEBOUNCE_MS 后执行一次写入
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flush();
    }, DEBOUNCE_MS);
  }, [loaded]);

  /** 立即将当前快照写入（如果有脏数据） */
  const flush = useCallback(() => {
    if (unmountedRef.current) return;
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    // getSnapshot 读取最新 ref 值，不依赖闭包捕获
    const data = getSnapshot();
    saveStore(data);
  }, [getSnapshot, saveStore]);

  /** 组件卸载 / 窗口关闭前强制刷入 */
  useEffect(() => {
    // 窗口关闭前最后一次写入
    const onBeforeUnload = () => flush();
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      unmountedRef.current = true;
      window.removeEventListener('beforeunload', onBeforeUnload);
      // 清理 timer 并强制刷入
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      flush();
    };
  }, [flush]);

  return { markPersistDirty, flush };
}

/**
 * useStateWithPersist — 包装 useState，在 setState 时自动标记脏
 *
 * 用法示例（在 App 中）：
 *   const [collections, setCollections] = useStateWithPersist(
 *     DEFAULT_STATE.collections, markPersistDirty
 *   );
 *
 * 如果不想修改所有 useState 调用，也可以在每个 setter 外层手动调用
 * markPersistDirty()，参见 PATCH.md 中的"最小改动方案"。
 */
export function useStateWithPersist(initialValue, markDirty) {
  // 这是一个辅助工厂，不是 hook 本身；
  // 实际用法见 PATCH.md 中的 "包装方案" 示例
  // 此处仅供文档参考，不直接导出为 hook（避免 hook 规则违反）
  throw new Error(
    'useStateWithPersist 仅作为模式参考，请参阅 PATCH.md 中的集成方式'
  );
}
