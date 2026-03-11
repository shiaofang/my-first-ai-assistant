import 'dotenv/config'
import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors({ origin: '*' }))
app.use(express.json())

// Ollama 配置：可以通过环境变量覆盖
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL
const OLLAMA_MODEL = process.env.OLLAMA_MODEL

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body ?? {}

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages 必须是数组' })
  }

  try {
    const ollamaRes = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: false,
      }),
    })

    if (!ollamaRes.ok) {
      const errorText = await ollamaRes.text().catch(() => '')
      return res.status(500).json({
        error: '调用 Ollama 失败',
        status: ollamaRes.status,
        body: errorText,
      })
    }

    const data = await ollamaRes.json()
    const text = data?.message?.content ?? ''

    res.json({ reply: text })
  } catch (err) {
    console.error('调用 Ollama 出错:', err)
    res.status(500).json({ error: '服务器内部错误' })
  }
})

app.listen(3001, () => {
  console.log('[chat-server] 已启动，后端使用 Ollama → http://localhost:3001')
})
