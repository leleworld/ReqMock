# ReqMock

一款桌面端 API 调试客户端 + Mock 服务器工具，类似 Postman，采用 JetBrains 风格 UI 设计。

![Electron](https://img.shields.io/badge/Electron-33-47848F?logo=electron)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite)
![Platform](https://img.shields.io/badge/Platform-Windows%20x64-0078D6?logo=windows)

## ✨ 功能特性

### HTTP 客户端
- 支持 HTTP/1.1、HTTP/2
- 代理设置 & 重定向控制
- 请求取消（AbortController）
- 前置/后置脚本（Pre-request / Post-request Script）
- Cookie 自动管理（RFC 6265）
- 环境变量 & 变量替换
- 请求参数预设（分页、时间戳、排序等）
- Headers 预设
- cURL 导入 / HAR 导入

### Mock 服务器
- 模板响应 / 脚本响应 / 条件路由
- 动态端口启停
- 路由热更新

### 实时连接
- WebSocket 客户端（消息搜索）
- SSE 客户端（支持 3xx 重定向）

### 集合管理
- Collection Runner（支持并发执行）
- 集合树拖拽排序
- 请求历史记录（搜索 + 200 条上限）

### 代码编辑器
- 基于 CodeMirror 6
- JSON / XML / HTML 语法高亮
- 代码折叠（动画效果）
- 搜索替换（自动展开折叠区域定位）
- 行注释切换（Ctrl+/）
- 脚本模板库（快速插入常用代码片段）

### 快捷键（IDEA 风格）
| 快捷键 | 功能 |
|--------|------|
| Shift+F10 | 发送请求 |
| Ctrl+Shift+A | 命令面板 |
| Ctrl+S | 保存 |
| Ctrl+T | 新建标签 |
| Ctrl+F4 | 关闭标签 |
| Ctrl+D | 复制标签 |
| Alt+← / → | 切换标签 |
| Ctrl+E | 切换环境 |
| Alt+1 | 切换侧边栏 |
| Ctrl+/ | 注释行 |
| F1 | 快捷键速查 |

### 其他
- 深色 / 浅色主题切换
- 标签拖拽排序 & 双击重命名
- 标签右键菜单（关闭所有/左侧/右侧）
- 环境快速切换下拉
- 自动更新（GitHub Releases）
- GPU 加速自适应（RDP/VM 环境兼容）

## 🚀 快速开始

### 环境要求

- Node.js >= 18
- npm >= 9

### 开发

```bash
# 安装依赖
npm install

# 启动开发服务器（Vite + Electron）
npm run dev
```

### 构建

```bash
# 打包 Windows x64 安装包
npm run dist
```

构建产物输出到 `release/` 目录。

## 📦 自动构建 & 发布

项目使用 GitHub Actions 自动构建。推送 tag 即可触发：

```bash
# 更新 package.json 中的 version
git tag v0.2.0
git push origin v0.2.0
```

CI 会自动：
1. 安装依赖 & 构建前端
2. electron-builder 打包 Windows NSIS 安装包
3. 创建 GitHub Release 并上传安装包

用户打开 App 后会自动检测更新。

## 🏗️ 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Electron 33 |
| 前端 | React 18 + Vite 6 |
| 编辑器 | CodeMirror 6 |
| 打包 | electron-builder (NSIS) |
| 自动更新 | electron-updater (GitHub provider) |
| CI/CD | GitHub Actions |

## 📁 项目结构

```
ReqMock/
├── electron/           # 主进程
│   ├── main.cjs        # 入口：窗口管理、IPC 注册
│   ├── preload.cjs     # 预加载脚本（contextBridge）
│   ├── httpClient.cjs  # HTTP 请求引擎
│   ├── mockServer.cjs  # Mock 服务器
│   ├── wsClient.cjs    # WebSocket 管理
│   ├── sseClient.cjs   # SSE 管理
│   ├── store.cjs       # 数据持久化
│   ├── updater.cjs     # 自动更新
│   └── mockScript.cjs  # Mock 脚本沙箱
├── src/                # 渲染进程（React）
│   ├── components/     # UI 组件
│   ├── contexts/       # React Context
│   ├── hooks/          # 自定义 Hooks
│   ├── utils/          # 工具函数
│   ├── styles.css      # 全局样式
│   ├── App.jsx         # 主应用
│   └── main.jsx        # 入口
├── public/             # 静态资源
├── build/              # 构建资源（图标等）
├── tests/              # 测试
└── .github/workflows/  # CI 配置
```

## 📄 License

MIT
