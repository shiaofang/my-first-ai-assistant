<script setup lang="ts">
import { ref } from 'vue'

const messages = ref<{ role: string; content: string }[]>([])
const input = ref('')
const loading = ref(false)
const popoverVisible = ref(false)

// 核心：把当前对话历史发给 /api/chat，拿到 reply 再追加到 messages
async function sendMessage() {
  const content = input.value.trim()
  if (!content || loading.value) return

  messages.value.push({ role: 'user', content })
  input.value = ''
  loading.value = true

  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: messages.value.map((m) => ({ role: m.role, content: m.content })),
    }),
  })
  const data = await res.json()
  messages.value.push({ role: 'assistant', content: data.reply ?? '' })
  loading.value = false
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
    <el-popover v-model:visible="popoverVisible" placement="top-start" width="760" trigger="click">
      <template #reference>
        <button class="ai-fab" type="button">AI</button>
      </template>

      <div class="chat">
        <div class="chat-header">AI 助手</div>
        <div class="chat-messages">
          <div v-for="(msg, i) in messages" :key="i" class="chat-message" :class="`chat-message--${msg.role}`">
            <div class="chat-bubble">{{ msg.content }}</div>
          </div>
          <div v-if="!messages.length" class="chat-empty">输入内容与 AI 对话</div>
        </div>
        <div class="chat-input">
          <el-input v-model="input" type="textarea" :rows="2" placeholder="输入..." @keydown="onKeydown" />
          <el-button type="primary" size="small" :loading="loading" @click="sendMessage">
            发送
          </el-button>
        </div>
      </div>
    </el-popover>
  </div>
</template>

<style scoped>
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
}

.ai-fab:hover {
  background-color: #66b1ff;
}

.chat {
  display: flex;
  flex-direction: column;
  height: 560px;
}

.chat-header {
  font-size: 14px;
  font-weight: 600;
  margin-bottom: 8px;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.chat-message {
  display: flex;
  margin-bottom: 8px;
}

.chat-message--user {
  justify-content: flex-end;
}

.chat-message--assistant {
  justify-content: flex-start;
}

.chat-bubble {
  max-width: 100%;
  padding: 10px 14px;
  border-radius: 16px;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
  white-space: pre-wrap;
}

.chat-message--user .chat-bubble {
  background-color: #409eff;
  color: #fff;
  border-bottom-right-radius: 4px;
}

.chat-message--assistant .chat-bubble {
  background-color: #f2f3f5;
  color: #303133;
  border-bottom-left-radius: 4px;
  overflow: auto;
}

.chat-empty {
  font-size: 12px;
  color: #909399;
  text-align: center;
  margin-top: 24px;
}

.chat-input {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chat-input .el-button {
  align-self: flex-end;
}
</style>
