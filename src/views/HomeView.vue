<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { ElMessage } from 'element-plus'
import { marked } from 'marked'

// 配置 marked：启用 GitHub Flavored Markdown（支持表格、代码块等）
marked.setOptions({ breaks: true })

// ========== 状态 ==========
const messages = ref<{ role: string; content: string }[]>([])
const input = ref('')
const loading = ref(false)
const popoverVisible = ref(false)
const messagesRef = ref<HTMLElement | null>(null)

// AbortController：用于中途取消正在进行的流式请求
let abortController: AbortController | null = null

// 终止当前生成
function stopGeneration() {
  abortController?.abort()
  abortController = null
  loading.value = false
}

// RAG 相关
const useRag = ref(false)
const uploading = ref(false)
const uploadedFiles = ref<string[]>([])

// ========== 工具函数 ==========

// 把 Markdown 文本转成 HTML（用于 v-html 渲染）
function renderMarkdown(content: string): string {
  return marked(content) as string
}

// 自动滚动到消息列表底部
async function scrollToBottom() {
  await nextTick()
  if (messagesRef.value) {
    messagesRef.value.scrollTop = messagesRef.value.scrollHeight
  }
}

// ========== 页面初始化 ==========

// 启动时从后端读取已有向量库状态
onMounted(async () => {
  try {
    const res = await fetch('/api/rag/stats')
    const data = await res.json()
    if (data.sources?.length) {
      uploadedFiles.value = data.sources
      useRag.value = true
    }
  } catch {
    // 后端未启动时静默忽略
  }
})

// ========== 发送消息（流式接收）==========
async function sendMessage() {
  const content = input.value.trim()
  if (!content || loading.value) return

  messages.value.push({ role: 'user', content })
  input.value = ''
  loading.value = true
  scrollToBottom()

  // 预先插入一条空的 AI 消息，后续流式追加内容到这条消息
  messages.value.push({ role: 'assistant', content: '' })
  const assistantIndex = messages.value.length - 1

  try {
    // 每次发送前创建新的 AbortController，用于后续终止请求
    abortController = new AbortController()

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: abortController.signal,  // 把终止信号绑定到 fetch 请求
      body: JSON.stringify({
        messages: messages.value
          .slice(0, -1)  // 不把刚插入的空 assistant 消息发给后端
          .map((m) => ({ role: m.role, content: m.content })),
        useRag: useRag.value,
      }),
    })

    // 用 ReadableStream 逐块读取 SSE 响应
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      // 解码字节流为字符串，可能包含多行 SSE 数据
      const raw = decoder.decode(value, { stream: true })
      const lines = raw.split('\n')

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue

        const data = line.slice(6).trim()  // 去掉 "data: " 前缀
        if (data === '[DONE]') break

        try {
          const parsed = JSON.parse(data)
          const target = messages.value[assistantIndex]
          if (!target) continue
          if (parsed.error) {
            target.content = `错误：${parsed.error}`
          } else if (parsed.text) {
            // 流式追加文字，触发 Vue 响应式更新
            target.content += parsed.text
            scrollToBottom()
          }
        } catch {
          // 解析失败跳过（可能是不完整的 chunk）
        }
      }
    }
  } catch (err: any) {
    // abort() 触发的错误不提示，属于用户主动终止
    if (err?.name !== 'AbortError') {
      const target = messages.value[assistantIndex]
      if (target) target.content = '请求失败，请检查后端服务是否启动'
    }
  } finally {
    abortController = null
    loading.value = false
    scrollToBottom()
  }
}

// ========== 上传文档 ==========
async function handleUpload(file: File) {
  uploading.value = true
  const form = new FormData()
  form.append('file', file)

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: form })
    const data = await res.json()
    if (data.success) {
      uploadedFiles.value.push(file.name)
      ElMessage.success(data.message)
      useRag.value = true
    } else {
      ElMessage.error(data.error ?? '上传失败')
    }
  } catch {
    ElMessage.error('上传失败，请检查后端服务')
  } finally {
    uploading.value = false
  }
  return false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    sendMessage()
  }
}
</script>

<template>
  <div class="home">
    <el-popover v-model:visible="popoverVisible" placement="top-start" width="820" trigger="click">
      <template #reference>
        <button class="ai-fab" type="button">AI</button>
      </template>

      <div class="chat">
        <!-- 头部 -->
        <div class="chat-header">
          <span class="chat-title">AI 助手</span>
          <div class="header-actions">
            <span class="rag-label">知识库问答</span>
            <el-switch v-model="useRag" size="small" :disabled="uploadedFiles.length === 0" />
          </div>
        </div>

        <!-- 文档上传区域 -->
        <div class="upload-area">
          <el-upload :before-upload="handleUpload" :show-file-list="false" accept=".txt,.docx" :disabled="uploading">
            <el-button size="small" :loading="uploading" plain>
              {{ uploading ? '处理中...' : '上传知识文档 (.txt / .docx)' }}
            </el-button>
          </el-upload>
          <div v-if="uploadedFiles.length" class="uploaded-list">
            <el-tag v-for="name in uploadedFiles" :key="name" size="small" type="success" style="margin-left: 4px">
              {{ name }}
            </el-tag>
          </div>
        </div>

        <!-- 消息列表 -->
        <div ref="messagesRef" class="chat-messages">
          <!-- 欢迎提示 -->
          <div v-if="!messages.length" class="chat-empty">
            <p>上传文档后开启「知识库问答」，AI 将基于文档内容回答</p>
            <p>或直接输入内容与 AI 对话</p>
          </div>

          <div v-for="(msg, i) in messages" :key="i" class="chat-message" :class="`chat-message--${msg.role}`">
            <!-- 用户消息：纯文本气泡 -->
            <div v-if="msg.role === 'user'" class="user-bubble">
              {{ msg.content }}
            </div>

            <!-- AI 消息：渲染 Markdown，仿 Ollama 样式 -->
            <div v-else class="assistant-content">
              <!-- 思考中动画（内容为空时显示） -->
              <div v-if="!msg.content && loading" class="thinking">
                <span class="thinking-dot" />
                <span class="thinking-dot" />
                <span class="thinking-dot" />
              </div>
              <!-- Markdown 渲染区域 -->
              <div v-else class="markdown-body" v-html="renderMarkdown(msg.content)" />
            </div>
          </div>
        </div>

        <!-- 输入区 -->
        <div class="chat-input">
          <el-input v-model="input" type="textarea" :rows="2" :placeholder="useRag ? '基于知识库提问...' : '输入内容与 AI 对话...'"
            @keydown="onKeydown" />
          <div class="input-footer">
            <el-tag v-if="useRag" size="small" type="warning">RAG 模式</el-tag>

            <el-button
              :type="loading ? 'danger' : 'primary'"
              size="small"
              @click="loading ? stopGeneration() : sendMessage()"
            >
              {{ loading ? '暂停' : '发送' }}
            </el-button>
          </div>
        </div>
      </div>
    </el-popover>
  </div>
</template>

<style scoped>
/* ===== 整体布局 ===== */
.home {
  position: relative;
  min-height: 100vh;
}

.ai-fab {
  position: fixed;
  right: 24px;
  bottom: 24px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  border: none;
  background: #409eff;
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(64, 158, 255, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
}

.ai-fab:hover {
  background-color: #66b1ff;
}

.chat {
  display: flex;
  flex-direction: column;
  height: 640px;
}

/* ===== 头部 ===== */
.chat-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid #f0f0f0;
}

.chat-title {
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.rag-label {
  font-size: 12px;
  color: #606266;
}

/* ===== 上传区域 ===== */
.upload-area {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: #f9f9f9;
  border-radius: 6px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.uploaded-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

/* ===== 消息列表 ===== */
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0 8px;
  scroll-behavior: smooth;
}

.chat-message {
  margin-bottom: 20px;
}

/* 用户消息：右对齐蓝色气泡 */
.chat-message--user {
  display: flex;
  justify-content: flex-end;
}

.user-bubble {
  max-width: 75%;
  padding: 10px 14px;
  background: #409eff;
  color: #fff;
  border-radius: 16px 16px 4px 16px;
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
  white-space: pre-wrap;
}

/* AI 消息：左对齐，无气泡，直接渲染 Markdown */
.chat-message--assistant {
  display: flex;
  justify-content: flex-start;
}

.assistant-content {
  max-width: 100%;
  width: 100%;
}

/* ===== 思考中动画 ===== */
.thinking {
  display: flex;
  gap: 4px;
  padding: 8px 0;
  align-items: center;
}

.thinking-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #c0c4cc;
  animation: bounce 1.2s infinite ease-in-out;
}

.thinking-dot:nth-child(2) {
  animation-delay: 0.2s;
}

.thinking-dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes bounce {

  0%,
  80%,
  100% {
    transform: scale(0.8);
    opacity: 0.5;
  }

  40% {
    transform: scale(1.2);
    opacity: 1;
  }
}

/* ===== Markdown 渲染样式（仿 Ollama）===== */
.markdown-body {
  font-size: 14px;
  line-height: 1.75;
  color: #1a1a1a;
  word-break: break-word;
}

/* 段落 */
.markdown-body :deep(p) {
  margin: 0 0 12px;
}

.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}

/* 标题 */
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  font-weight: 600;
  margin: 16px 0 8px;
  line-height: 1.4;
  color: #111;
}

.markdown-body :deep(h1) {
  font-size: 20px;
}

.markdown-body :deep(h2) {
  font-size: 17px;
}

.markdown-body :deep(h3) {
  font-size: 15px;
}

/* 列表 */
.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 20px;
  margin: 8px 0 12px;
}

.markdown-body :deep(li) {
  margin-bottom: 4px;
}

/* 行内代码 */
.markdown-body :deep(code) {
  background: #f3f4f6;
  border: 1px solid #e5e7eb;
  border-radius: 4px;
  padding: 1px 5px;
  font-family: 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
  color: #e83e8c;
}

/* 代码块 */
.markdown-body :deep(pre) {
  background: #1e1e1e;
  border-radius: 8px;
  padding: 14px 16px;
  overflow-x: auto;
  margin: 10px 0;
}

.markdown-body :deep(pre code) {
  background: none;
  border: none;
  padding: 0;
  color: #d4d4d4;
  font-size: 13px;
}

/* 表格 */
.markdown-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 10px 0;
  font-size: 13px;
}

.markdown-body :deep(th) {
  background: #f5f5f5;
  font-weight: 600;
  text-align: left;
  padding: 8px 12px;
  border: 1px solid #e0e0e0;
}

.markdown-body :deep(td) {
  padding: 7px 12px;
  border: 1px solid #e0e0e0;
}

.markdown-body :deep(tr:hover td) {
  background: #fafafa;
}

/* 分割线 */
.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid #e5e7eb;
  margin: 14px 0;
}

/* 引用块 */
.markdown-body :deep(blockquote) {
  border-left: 3px solid #409eff;
  margin: 10px 0;
  padding: 6px 12px;
  color: #606266;
  background: #f0f7ff;
  border-radius: 0 6px 6px 0;
}

/* 加粗 */
.markdown-body :deep(strong) {
  font-weight: 600;
  color: #111;
}

/* ===== 输入区 ===== */
.chat-empty {
  font-size: 13px;
  color: #909399;
  text-align: center;
  margin-top: 30px;
  line-height: 2.2;
}

.chat-input {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-top: 1px solid #f0f0f0;
  padding-top: 10px;
}

.input-footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}

</style>
