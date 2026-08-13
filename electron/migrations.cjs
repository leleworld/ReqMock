/**
 * 数据迁移函数注册表
 *
 * 每个迁移函数负责将数据从 version N 升级到 version N+1。
 * 迁移链会自动按版本号顺序执行，直到到达 CURRENT_VERSION。
 *
 * 添加新迁移步骤：
 *   1. 将 CURRENT_VERSION 加 1
 *   2. 在 migrations 数组末尾添加对应迁移函数
 *   3. 确保迁移函数返回升级后的 state 对象
 */

/**
 * 当前最新数据版本号
 * 每次变更数据结构时 +1，并在 migrations 中添加对应迁移函数
 */
const CURRENT_VERSION = 2;

/**
 * 迁移函数数组（索引 0 = v1→v2, 索引 1 = v2→v3, 以此类推）
 *
 * 每个函数签名: (state) => state
 *   - 接收旧版本 state，返回新版本 state
 *   - 不要修改 __version 字段（Store 会自动处理）
 *   - 抛出异常视为迁移失败，Store 会备份原文件并返回原始数据
 */
const migrations = [
  // ─── v1 → v2 示例：添加 settings.theme 字段默认值 ───
  (state) => {
    // 假设 v2 要求 state 必须包含 settings 对象和 theme 字段
    if (!state.settings) {
      state.settings = {};
    }
    if (state.settings.theme === undefined) {
      state.settings.theme = 'system'; // 新字段默认值
    }
    // 假设 v2 将 state.lastOpen 重命名为 state.lastOpenedAt
    if (state.lastOpen !== undefined) {
      state.lastOpenedAt = state.lastOpen;
      delete state.lastOpen;
    }
    return state;
  },

  // ─── v2 → v3 示例（预留）：添加 recentFiles 数组 ───
  // (state) => {
  //   if (!Array.isArray(state.recentFiles)) {
  //     state.recentFiles = [];
  //   }
  //   return state;
  // },
];

module.exports = { CURRENT_VERSION, migrations };
