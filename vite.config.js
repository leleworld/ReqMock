import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// 从 package.json 注入版本号，供设置弹窗“关于”区块展示
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
  plugins: [
    react(),
    // 防止 HMR WebSocket 异常断开（Electron GPU 崩溃）导致 Vite dev server 进程退出
    {
      name: 'ws-error-guard',
      configureServer(server) {
        server.httpServer?.on('upgrade', () => {
          process.on('uncaughtException', (err) => {
            if (err.message && err.message.includes('WebSocket') || err.code === 'WS_ERR_INVALID_CLOSE_CODE') return;
            throw err; // 非 WebSocket 错误正常抛出
          });
        });
      }
    }
  ],
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
  server: {
    // 固定监听 IPv4：部分 Windows 环境下 localhost 优先解析为 ::1，vite 只听 IPv6 会导致
    // Electron 走 IPv4 连接时 ERR_EMPTY_RESPONSE，窗口黑屏
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    hmr: {
      // 防止 WebSocket 异常断开（如 Electron GPU 崩溃）导致 Vite 进程崩溃
      // 客户端断开时忽略无效 close frame
      overlay: true
    }
  },
  build: {
    outDir: 'dist'
  }
});
