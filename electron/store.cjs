/**
 * JSON 文件持久化（userData 目录），写入原子化：先写临时文件再改名
 */
const fs = require('fs');
const path = require('path');

class Store {
  constructor(filePath) {
    this.filePath = filePath;
  }

  load() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return null;
      }
      const text = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  }

  save(state) {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tmpPath = this.filePath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.filePath);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
}

module.exports = { Store };
