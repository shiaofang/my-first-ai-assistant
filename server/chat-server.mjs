// ============================================================
//  chat-server.mjs —— AI 助手后端服务
//
//  职责：
//    1. 接收前端的聊天消息，转发给本地 Ollama 大模型
//    2. 支持文档上传：把 .txt / .docx 切块、向量化、存到本地
//    3. 支持 RAG 模式：用户提问时先检索相关文档片段，再让 AI 基于它回答
//
//  启动方式：npm run dev:server
//  监听端口：3001
// ============================================================


// ============================================================
//  一、导入依赖
// ============================================================

// Node.js 内置模块
import fs from 'fs'                        // 文件系统：读写文件、判断路径是否存在
import path from 'path'                    // 路径工具：拼接、解析文件路径
import { fileURLToPath } from 'url'        // ESM 模块中获取当前文件路径（替代 CommonJS 的 __dirname）

// 第三方基础模块
import 'dotenv/config'                     // 读取 .env 文件，把变量注入到 process.env
import express from 'express'             // Web 框架：创建 HTTP 服务器、注册路由
import cors from 'cors'                   // 跨域中间件：允许前端（5173端口）访问后端（3001端口）
import multer from 'multer'               // 文件上传中间件：处理 multipart/form-data 格式的请求

// 文档解析
import mammoth from 'mammoth'             // Word 文档解析：把 .docx 转成纯文本

// LangChain —— AI 调用框架
import { ChatOllama, OllamaEmbeddings } from '@langchain/ollama'       // 连接本地 Ollama 服务
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages' // 消息类型
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'         // 文本分块工具
import { Document } from '@langchain/core/documents'                              // 文档对象


// ============================================================
//  二、基础配置
// ============================================================

// ESM 模块中没有 __dirname，需要手动推导当前文件所在目录
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// 创建 Express 应用实例
const app = express()

// 注册中间件（中间件 = 每次请求都会经过的处理函数）
app.use(cors({ origin: '*' }))   // 允许所有来源跨域（开发环境用，生产环境应限制域名）
app.use(express.json())          // 解析请求体中的 JSON 数据，挂到 req.body 上


// ============================================================
//  三、文件上传配置（multer）
// ============================================================

// 上传的文件会先临时保存到 uploads/ 目录，处理完后删除
const uploadDir = path.join(__dirname, '../uploads')
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir)  // 目录不存在就自动创建

// upload.single('file') 表示：只接受一个文件，前端表单字段名必须叫 'file'
const upload = multer({ dest: uploadDir })


// ============================================================
//  四、LangChain AI 实例
// ============================================================

// 对话模型：用于和用户聊天、生成回答
// 模型名称和地址从 .env 文件读取，方便切换
const llm = new ChatOllama({
  baseUrl: process.env.OLLAMA_BASE_URL,   // 例：http://localhost:11434
  model: process.env.OLLAMA_MODEL,        // 例：gpt-oss:120b-cloud
})

// 嵌入模型（Embedding Model）：把文字转成一串数字（向量）
// 用途：把文档内容和用户问题都转成向量，再比较相似度
// nomic-embed-text 是专门做向量化的轻量模型，比对话模型小很多
const embeddings = new OllamaEmbeddings({
  baseUrl: process.env.OLLAMA_BASE_URL,
  model: 'nomic-embed-text',
})


// ============================================================
//  五、本地向量数据库（RAG 的核心存储）
// ============================================================

// 向量数据持久化到这个 JSON 文件，服务重启后不丢失
const VECTOR_STORE_PATH = path.join(__dirname, '../chromaDB/vectors.json')

// 内存中的向量列表，每条记录的结构：
// { vector: number[], content: string, metadata: { source: string } }
let vectorItems = []

/**
 * 余弦相似度
 * 计算两个向量之间的夹角，值域 [-1, 1]，越接近 1 说明越相似
 * RAG 检索时用这个函数判断哪些文档片段和用户问题最相关
 */
function cosineSimilarity(a, b) {
  let dot = 0    // 点积
  let normA = 0  // 向量 a 的长度平方
  let normB = 0  // 向量 b 的长度平方

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/**
 * 相似度检索
 * 把用户的问题转成向量，和所有文档片段逐一比较，返回最相似的 topK 条
 */
async function similaritySearch(queryText, topK = 3) {
  if (vectorItems.length === 0) return []

  // 把问题文本转成向量（调用 Ollama nomic-embed-text 模型）
  const queryVector = await embeddings.embedQuery(queryText)

  // 计算问题向量和每条文档向量的相似度，并打分
  const scored = vectorItems.map((item) => ({
    content: item.content,
    metadata: item.metadata,
    score: cosineSimilarity(queryVector, item.vector),
  }))

  // 按相似度从高到低排序，取前 topK 条
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, topK)
}

/**
 * 保存向量库到文件
 * 每次上传新文档后调用，确保数据持久化
 */
function saveVectorStore() {
  const dir = path.dirname(VECTOR_STORE_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(VECTOR_STORE_PATH, JSON.stringify(vectorItems), 'utf-8')
  console.log(`[RAG] 向量库已保存，共 ${vectorItems.length} 条记录`)
}

/**
 * 从文件加载向量库
 * 服务器启动时调用，恢复之前保存的数据
 */
function loadVectorStore() {
  if (!fs.existsSync(VECTOR_STORE_PATH)) return
  try {
    vectorItems = JSON.parse(fs.readFileSync(VECTOR_STORE_PATH, 'utf-8'))
    console.log(`[RAG] 已从文件加载 ${vectorItems.length} 条向量记录`)
  } catch (e) {
    console.warn('[RAG] 向量文件读取失败，使用空库:', e.message)
  }
}


// ============================================================
//  六、工具函数
// ============================================================

/**
 * 把前端传来的消息数组 转换成 LangChain 的消息对象
 *
 * 前端格式：[{ role: 'user', content: '你好' }, { role: 'assistant', content: '...' }]
 * LangChain 格式：[new HumanMessage('你好'), new AIMessage('...')]
 *
 * LangChain 用不同的消息类来区分角色，这样底层可以适配各种模型的 API 格式
 */
function toLangChainMessages(messages) {
  return messages.map((msg) => {
    switch (msg.role) {
      case 'system':    return new SystemMessage(msg.content)   // 系统提示词
      case 'assistant': return new AIMessage(msg.content)       // AI 的历史回复
      default:          return new HumanMessage(msg.content)    // 用户消息（默认）
    }
  })
}


// ============================================================
//  七、API 路由
// ============================================================

// ------------------------------------------------------------
//  路由一：上传文档并向量化
//  POST /api/upload
//  请求格式：multipart/form-data，字段名 'file'，支持 .txt / .docx
// ------------------------------------------------------------
app.post('/api/upload', upload.single('file'), async (req, res) => {
  // multer 处理完上传后，文件信息挂在 req.file 上
  if (!req.file) return res.status(400).json({ error: '请上传文件' })

  const filePath = req.file.path   // 临时文件的磁盘路径
  // multer 内部用 latin1 编码处理文件名，需要转回 utf-8 才能正确显示中文
  const originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8')

  try {
    // Step 1：根据扩展名选择不同的解析方式
    const ext = path.extname(originalName).toLowerCase()
    let content = ''

    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ path: filePath })
      content = result.value   // mammoth 返回的 value 就是纯文本内容
    } else {
      content = fs.readFileSync(filePath, 'utf-8')
    }

    if (!content.trim()) {
      fs.unlinkSync(filePath)
      return res.status(400).json({ error: '文档内容为空，请检查文件' })
    }

    // Step 2：文本分块
    // 大模型有 Token 限制，不能把整篇文档一次性塞进去
    // 所以要把文档切成小块，每块约 500 字，块间重叠 50 字保持上下文连贯
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 500,     // 每块最多 500 个字符
      chunkOverlap: 50,   // 相邻块重叠 50 字，避免关键信息被切断
    })
    const docs = await splitter.createDocuments([content], [{ source: originalName }])

    // Step 3：批量向量化
    // 把每个文本块转成向量数字数组（调用 Ollama nomic-embed-text 模型）
    const texts = docs.map((d) => d.pageContent)
    const vectors = await embeddings.embedDocuments(texts)

    // Step 4：把向量 + 原文 + 来源信息存入内存列表
    for (let i = 0; i < docs.length; i++) {
      vectorItems.push({
        vector: vectors[i],          // 数字向量（用于检索）
        content: docs[i].pageContent, // 原文内容（用于拼进提示词）
        metadata: docs[i].metadata,   // 元数据，如 { source: '文件名.txt' }
      })
    }

    // Step 5：保存到磁盘，重启服务后数据还在
    saveVectorStore()
    fs.unlinkSync(filePath)  // 删除临时文件，节省磁盘空间

    res.json({
      success: true,
      message: `文档「${originalName}」处理完成，共切分为 ${docs.length} 个片段`,
      chunks: docs.length,
      total: vectorItems.length,
    })
  } catch (err) {
    console.error('文档处理出错:', err)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    res.status(500).json({ error: '文档处理失败: ' + err.message })
  }
})


// ------------------------------------------------------------
//  路由二：查询向量库状态
//  GET /api/rag/stats
//  返回：已存了多少条向量，来自哪些文档
// ------------------------------------------------------------
app.get('/api/rag/stats', (_req, res) => {
  const total = vectorItems.length

  // 用 Set 去重，提取所有不重复的文档来源名
  const sources = [
    ...new Set(vectorItems.map((v) => v.metadata?.source).filter(Boolean))
  ]

  res.json({ total, sources })
})


// ------------------------------------------------------------
//  路由三：聊天接口（流式输出 SSE）
//  POST /api/chat
//  请求体：{ messages: [...], useRag: boolean }
//
//  响应格式：SSE（Server-Sent Events）
//    每个 chunk：data: {"text":"..."}\n\n
//    结束信号：data: [DONE]\n\n
// ------------------------------------------------------------
app.post('/api/chat', async (req, res) => {
  const { messages, useRag = false } = req.body ?? {}

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages 必须是数组' })
  }

  // 设置 SSE 响应头：告诉浏览器这是一个持续推送的文本流
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()  // 立即把响应头发出去，不要等到有数据再发

  try {
    // 取出最后一条用户消息，作为 RAG 检索的查询词
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')

    let contextPrompt = ''  // 检索到的文档内容（拼进 system 提示词用）

    // ---- RAG 模式：先检索再回答 ----
    if (useRag && lastUserMsg && vectorItems.length > 0) {
      const relevant = await similaritySearch(lastUserMsg.content, 3)

      if (relevant.length > 0) {
        const context = relevant.map((r) => r.content).join('\n\n---\n\n')
        contextPrompt = [
          '请根据以下参考资料回答用户问题。',
          '若资料中无相关内容，请如实说明，不要编造。',
          '',
          '参考资料：',
          context,
          '',
        ].join('\n')
      }
    }

    const finalMessages = contextPrompt
      ? [new SystemMessage(contextPrompt), ...toLangChainMessages(messages)]
      : toLangChainMessages(messages)

    // llm.stream() 返回一个异步迭代器，每次迭代得到一个文字 chunk
    // 相比 llm.invoke() 等全部完成再返回，stream() 生成一个字就推一个字
    const stream = await llm.stream(finalMessages)

    for await (const chunk of stream) {
      const text = chunk.content
      if (text) {
        // SSE 格式：必须是 "data: ...\n\n" 的形式
        res.write(`data: ${JSON.stringify({ text })}\n\n`)
      }
    }

    // 发送结束信号，前端收到后停止读取
    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err) {
    console.error('LangChain 调用出错:', err)
    // 流式响应出错时，也要用 SSE 格式发送错误信息
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
    res.end()
  }
})


// ============================================================
//  八、启动服务
// ============================================================

// 服务启动前先从磁盘加载历史向量数据
loadVectorStore()

// 监听 3001 端口，启动成功后打印提示
app.listen(3001, () => {
  console.log('')
  console.log('╔══════════════════════════════════════════════════╗')
  console.log('║         AI 助手后端服务已启动                    ║')
  console.log('╠══════════════════════════════════════════════════╣')
  console.log('║  地址：http://localhost:3001                      ║')
  console.log('║                                                    ║')
  console.log('║  POST  /api/chat        聊天（支持 RAG 模式）     ║')
  console.log('║  POST  /api/upload      上传文档并向量化          ║')
  console.log('║  GET   /api/rag/stats   查看知识库状态            ║')
  console.log('╚══════════════════════════════════════════════════╝')
  console.log('')
})
