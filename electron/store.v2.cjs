/**
 * JSON 文件持久化（带版本号 + 自动迁移）
 *
 * 特性：
 *   - save 时自动写入 __version 字段
 *   - load 时检测版本号，自动执行迁移链（v1→v2→v3…）
 *   - 迁移失败时备份原文件（.bak.{timestamp}），报错但不阻塞
 *   - 写入原子化：先写临时文件再 rename
 */
const fs = require('fs');
const path = require('path');
const { CURRENT_VERSION, migrations } = require('./migrations.cjs');

class Store {
  /**
   * @param {string} filePath - 持久化文件路径
   * @param {object} [options]
   * @param {boolean} [options.verbose=false] - 是否打印迁移日志到 console
   */
  constructor(filePath, options = {}) {
    this.filePath = filePath;
    this.verbose = options.verbose || false;
  }

  // ─── 公共方法 ────────────────────────────────────────────

  /**
   * 加载并迁移数据
   * @returns {object|null} 迁移后的 state，文件不存在或解析失败返回 null
   */
  load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null;
      }
      const text = fs.readFileSync(this.filePath, 'utf8');
      let state = JSON.parse(text);

      // 执行迁移
      state = this._migrate(state);

      return state;
    } catch (e) {
      this._log('error', `Store.load 失败: ${e.message}`);
      return null;
    }
  }

  /**
   * 保存数据（自动注入 __version）
   * @param {object} state - 要保存的状态对象
   * @returns {{ ok: boolean, error?: string }}
   */
  save(state) {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 注入当前版本号
      const dataToSave = { ...state, __version: CURRENT_VERSION };

      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(dataToSave, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.filePath);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ─── 内部方法 ────────────────────────────────────────────

  /**
   * 执行迁移链
   * @param {object} state - 原始数据
   * @returns {object} 迁移后的数据
   */
  _migrate(state) {
    // 无版本号视为 v1（兼容旧数据）
    const fileVersion = state.__version || 1;

    if (fileVersion >= CURRENT_VERSION) {
      // 版本一致或更新，无需迁移
      return state;
    }

    this._log('info', `检测到数据版本 v${fileVersion}，需迁移到 v${CURRENT_VERSION}`);

    // 迁移前备份原文件
    const backupPath = this._backup();
    if (backupPath) {
      this._log('info', `已备份原文件: ${backupPath}`);
    }

    let current = { ...state };
    for (let v = fileVersion; v < CURRENT_VERSION; v++) {
      const migrationIndex = v - 1; // migrations[0] = v1→v2
      const migrateFn = migrations[migrationIndex];

      if (typeof migrateFn !== 'function') {
        this._log('warn', `缺少迁移函数 v${v}→v${v + 1}，跳过`);
        continue;
      }

      try {
        this._log('info', `执行迁移 v${v} → v${v + 1}`);
        current = migrateFn(current);
      } catch (e) {
        // 迁移失败：报错但不阻塞，返回迁移到当前步骤的数据
        this._log('error', `迁移 v${v}→v${v + 1} 失败: ${e.message}`);
        this._log('error', `备份文件位于: ${backupPath}`);
        // 将 __version 设为当前到达的版本，下次启动可重试
        current.__version = v;
        return current;
      }
    }

    // 迁移完成，更新版本号并自动持久化
    current.__version = CURRENT_VERSION;
    this.save(current);
    this._log('info', `迁移完成，当前版本 v${CURRENT_VERSION}`);

    return current;
  }

  /**
   * 备份当前文件
   * @returns {string|null} 备份文件路径，失败返回 null
   */
  _backup() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null;
      }
      const timestamp = Date.now();
      const backupPath = `${this.filePath}.bak.${timestamp}`;
      fs.copyFileSync(this.filePath, backupPath);
      return backupPath;
    } catch (e) {
      this._log('error', `备份失败: ${e.message}`);
      return null;
    }
  }

  /**
   * 日志输出
   * @param {'info'|'warn'|'error'} level
   * @param {string} msg
   */
  _log(level, msg) {
    if (!this.verbose && level === 'info') return;
    const prefix = `[Store]`;
    switch (level) {
      case 'error':
        console.error(`${prefix} ❌ ${msg}`);
        break;
      case 'warn':
        console.warn(`${prefix} ⚠️ ${msg}`);
        break;
      default:
        console.log(`${prefix} ${msg}`);
    }
  }
}

module.exports = { Store };
