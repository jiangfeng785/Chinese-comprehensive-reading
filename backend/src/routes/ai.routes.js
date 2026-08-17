// backend/src/routes/ai.routes.js
// AI 流式对话路由 - 提供 DeepSeek 大模型 SSE 流式对话接口
// 接口: /local (局部解释) / /structure (全文分析) / /hint (分步提示) / /chat (自由对话) / /test
// 注意: 本路由仅负责流式转发 AI 回复, 持久化由前端收到完整回复后调用 /api/ai-interactions/save 完成

const express = require('express');
const {
  explainLocalStream,
  summarizeStructureStream,
  generateHintStream,
  chatStream,
} = require('../services/deepseek.service');

const router = express.Router();

/**
 * POST /api/ai/local
 * 看懂这里 - 解释选中文本 (SSE 流式)
 *
 * @param {string} req.body.selectedText - 选中的文本片段
 * @param {string} req.body.fullText - 文章全文
 * @returns {SSE} data: { content } | { done: true } | { error }
 */
router.post('/local', async (req, res) => {
  const { selectedText, fullText } = req.body;

  if (!selectedText || selectedText.trim().length === 0) {
    return res.status(400).json({ success: false, message: '请先选中文章中的文本' });
  }

  // 设置 SSE 响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  try {
    await explainLocalStream(selectedText, fullText, (chunk) => {
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
    });
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

/**
 * POST /api/ai/structure
 * 理清全文 - 文章结构分析 (SSE 流式)
 *
 * @param {string} req.body.fullText - 文章全文
 * @returns {SSE} data: { content } | { done: true } | { error }
 */
router.post('/structure', async (req, res) => {
  const { fullText } = req.body;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  try {
    await summarizeStructureStream(fullText, (chunk) => {
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
    });
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

/**
 * POST /api/ai/hint
 * 给我提示 - 分步引导答题 (SSE 流式)
 *
 * @param {string} req.body.fullText - 文章全文
 * @param {string} req.body.question - 当前题目
 * @param {string} req.body.userAnswer - 学生当前答案
 * @param {number} [req.body.step=1] - 提示步数
 * @returns {SSE} data: { content } | { done: true } | { error }
 */
router.post('/hint', async (req, res) => {
  const { fullText, question, userAnswer, step = 1 } = req.body;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  try {
    await generateHintStream(fullText, question, userAnswer, step, (chunk) => {
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
    });
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

/**
 * POST /api/ai/chat
 * 自由对话 - 用户自由提问, AI 结合文章内容回答 (SSE 流式)
 *
 * @param {string} req.body.message - 用户提问内容
 * @param {string} req.body.fullText - 文章全文
 * @returns {SSE} data: { content } | { done: true } | { error }
 */
router.post('/chat', async (req, res) => {
  const { message, fullText } = req.body;

  if (!message || message.trim().length === 0) {
    return res.status(400).json({ success: false, message: '消息不能为空' });
  }

  // 设置 SSE 响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  try {
    await chatStream(message, fullText, (chunk) => {
      res.write(`data: ${JSON.stringify({ content: chunk })}\n\n`);
    });
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
});

/**
 * POST /api/ai/test
 * 测试接口 - 验证 AI 路由连通性 (非流式)
 *
 * @returns {Object} JSON - { success, data: { explanation } }
 */
router.post('/test', (req, res) => {
  res.json({
    success: true,
    data: {
      explanation: 'AI 测试回复: 后端接口正常。'
    }
  });
});

module.exports = router;
