# ai-zhushou

一个基于 **Vue 3 + Vite + TypeScript + Element Plus** 的轻量「AI 助手」前端 Demo，并内置一个 **Express** 后端代理服务，用来把前端对话请求转发到本地 **Ollama**（避免浏览器跨域/直连模型服务等问题）。

## 功能简介

- **悬浮按钮**：页面右下角 `AI` 浮动按钮，一键打开对话框
- **对话能力**：把当前对话历史 `messages` 提交到 `/api/chat`，拿到回复后追加展示
- **后端代理**：`POST /api/chat` → 转发到 `OLLAMA_BASE_URL/api/chat`，返回 `{ reply }`

## 技术栈

- **前端**：Vue 3、Vite、TypeScript、Vue Router、Pinia、Element Plus
- **后端**：Node.js（ESM）、Express、cors、dotenv
- **模型服务**：Ollama（本地运行）

## 目录结构（核心）

```text
.
├─ src/
│  ├─ views/HomeView.vue        # 悬浮按钮 + 对话 UI（调用 /api/chat）
│  ├─ router/index.ts           # 单页路由（/ → HomeView）
│  └─ main.ts                   # 应用入口（Pinia/Router/ElementPlus）
├─ server/chat-server.mjs       # Express 后端：/api/chat → Ollama
├─ vite.config.ts               # Vite 代理：/api → http://localhost:3001
└─ .env                         # Ollama 地址/模型（可按需修改）
```

## 环境要求

- **Node.js**：建议使用较新版本（项目使用 ESM，且 `package.json` 声明了 `type: module`）
- **Ollama**：本地已安装并启动（默认监听 `http://localhost:11434`）

## 快速开始

### 1) 安装依赖

```bash
npm install
```

### 2) 配置环境变量（Ollama）

在项目根目录创建或修改 `.env`（示例）：

```env
OLLAMA_BASE_URL="http://localhost:11434"
OLLAMA_MODEL="gpt-oss:120b-cloud"
# OLLAMA_MODEL="qwen3-coder-next:cloud"
# OLLAMA_MODEL="qwen3.5:0.8b"
```

### 3) 启动后端代理（端口 3001）

```bash
npm run dev:server
```

启动成功会看到类似日志：`[chat-server] 已启动 ... http://localhost:3001`

### 4) 启动前端（Vite）

另开一个终端执行：

```bash
npm run dev
```

前端会通过 `vite.config.ts` 把 `/api` 代理到 `http://localhost:3001`，因此浏览器里请求 `/api/chat` 会自动走后端代理。

## 接口说明

### `POST /api/chat`

- **请求体**

```json
{
  "messages": [
    { "role": "user", "content": "你好" },
    { "role": "assistant", "content": "你好！有什么我可以帮忙的？" }
  ]
}
```

- **返回体**

```json
{ "reply": "..." }
```

## 常见问题（FAQ）

### 1) 点击发送无回复 / 控制台 500

- **检查 Ollama 是否启动**：默认 `http://localhost:11434`
- **检查模型名是否存在**：`.env` 的 `OLLAMA_MODEL` 必须是 Ollama 可用的 model
- **检查后端是否启动**：`npm run dev:server`（监听 `3001`）

### 2) 前端报跨域（CORS）

正常情况下前端不会跨域：因为 Vite 通过代理把 `/api` 转到后端（同源）。
如果你绕过代理直接请求 `http://localhost:3001/api/chat`，才会涉及跨域。

### 3) 端口占用

- 后端默认 `3001`：如被占用，修改 `server/chat-server.mjs` 监听端口，并同步修改 `vite.config.ts` 的 proxy target。

## 构建与预览

```bash
npm run build
npm run preview
```

> 注意：`preview` 仅预览前端构建产物；如需对话功能仍需后端代理与 Ollama 同时运行（或改为你自己的线上服务）。
