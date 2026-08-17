// backend/src/services/deepseek.service.js
// DeepSeek AI 服务：封装流式/非流式聊天调用，提供局部解释、结构概览、分步提示与自由对话能力。
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
});

/**
 * 核心函数：调用 DeepSeek API（流式模式）。
 * 逐块接收响应并通过回调推送给调用方，同时拼接完整内容返回。
 * @param {string} systemPrompt - 系统提示词，设定 AI 角色与规则
 * @param {string} userPrompt   - 用户提示词，包含具体任务输入
 * @param {(chunk: string) => void} [onChunk] - 流式回调，每收到一段内容即触发
 * @returns {Promise<string>} 完整的 AI 响应文本
 * @throws {Error} API 调用失败时抛出友好错误信息
 */
async function callDeepSeekStream(systemPrompt, userPrompt, onChunk) {
  try {
    const stream = await openai.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 600,
      stream: true, // 开启流式
    });

    let fullContent = '';
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        fullContent += content;
        if (onChunk) onChunk(content);
      }
    }
    return fullContent;
  } catch (error) {
    // 记录原始错误信息，便于排查 API 故障
    console.error('DeepSeek API 流式调用失败:', error.message);
    throw new Error('AI 服务暂时不可用，请稍后重试');
  }
}

/**
 * 非流式调用 DeepSeek API（兼容旧接口，一次性返回完整结果）。
 * @param {string} systemPrompt - 系统提示词
 * @param {string} userPrompt   - 用户提示词
 * @returns {Promise<string>} AI 响应文本
 * @throws {Error} API 调用失败时抛出友好错误信息
 */
async function callDeepSeek(systemPrompt, userPrompt) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 500,
    });
    return completion.choices[0].message.content;
  } catch (error) {
    console.error('DeepSeek API 调用失败:', error.message);
    throw new Error('AI 服务暂时不可用，请稍后重试');
  }
}

/**
 * 功能1：看懂这里（局部解释）- 流式输出
 * 结合全文上下文解释用户选中文本的含义，不涉及题目答案。
 * @param {string} selectedText - 用户选中的文本片段
 * @param {string} fullText     - 文章全文，用于提供语境
 * @param {(chunk: string) => void} [onChunk] - 流式回调
 * @returns {Promise<string>} 完整解释文本
 */
async function explainLocalStream(selectedText, fullText, onChunk) {
  const systemPrompt = `你是一位专业的中文阅读助教。
规则：
1. 只解释用户选中的文本在当前语境下的意思（词语含义、指代关系、句法结构）。
2. 必须结合全文上下文，给出具体的语境化解释，而不是字典释义。
3. 绝对不要提及任何选择题、选项或正确答案。
4. 回复控制在 150 字以内，语言简洁清晰。`;

  const userPrompt = `全文内容："${fullText}"\\n\\n用户选中的文本："${selectedText}"\\n\\n请结合全文，解释这段文本在文中的具体含义和作用。`;

  return await callDeepSeekStream(systemPrompt, userPrompt, onChunk);
}

/**
 * 功能2：理清全文（结构概览）- 流式输出
 * 分析文章段落功能、衔接关系与核心主线，纯文本输出。
 * @param {string} fullText - 文章全文
 * @param {(chunk: string) => void} [onChunk] - 流式回调
 * @returns {Promise<string>} 完整结构分析文本
 */
async function summarizeStructureStream(fullText, onChunk) {
  const systemPrompt = `你是一位专业的中文阅读助教。
任务：分析文章的整体结构。
输出格式：
1. 段落功能（逐段概括），每段之间要换行
2. 衔接关系（段落之间的逻辑连接）
3. 全文主线（文章的核心论点）
规则：
1. 绝对不要提及任何选择题、选项或正确答案。
2. 不要生成思维导图、流程图或任何图表内容。
3. 不要使用 Mermaid 语法或任何图形描述格式。
4. 只输出纯文本分析。`;

  const userPrompt = `请分析以下文章的结构：\\n\\n"${fullText}"`;

  return await callDeepSeekStream(systemPrompt, userPrompt, onChunk);
}

/**
 * 功能3：给我提示（分三步引导推理）- 流式输出
 * step 1 给方向 → step 2 指证据 → step 3 引导整合，全程不透露答案。
 * @param {string} fullText   - 文章全文
 * @param {string} question   - 当前题目
 * @param {string} userAnswer - 学生当前选择（可为空）
 * @param {1|2|3} step        - 提示步骤
 * @param {(chunk: string) => void} [onChunk] - 流式回调
 * @returns {Promise<string>} 当前步骤的提示文本
 */
async function generateHintStream(fullText, question, userAnswer, step, onChunk) {
  // 三步渐进式提示策略：方向 → 证据 → 整合
  const stepPrompts = {
    1: `给出一个思考方向，让学生知道应该关注哪个段落或哪个概念。只给一句话，不要透露答案。`,
    2: `指出相关的原文证据（具体句子或段落），并引导学生思考这些证据与问题的关系。不要给出结论。`,
    3: `提示学生如何整合前面的证据得出结论，但仍然不要直接说出正确答案。`
  };

  const systemPrompt = `你是一位专业的中文阅读助教。
任务：给学生提供推理引导。
当前步骤：${stepPrompts[step] || stepPrompts[1]}
规则：
1. 绝对不要直接说出正确答案。
2. 不要提及选项字母（A/B/C/D）。
3. 只引导学生自己发现答案。
4. 回复控制在 100 字以内。`;

  const userPrompt = `文章："${fullText}"\\n问题："${question}"\\n学生当前选择："${userAnswer || '未选择'}"`;

  return await callDeepSeekStream(systemPrompt, userPrompt, onChunk);
}

/**
 * 功能4：自由对话 - 流式输出
 * 用户可自由提问，AI 结合文章内容作答；与文章无关的问题会被礼貌拒绝。
 * @param {string} message  - 用户提问内容
 * @param {string} fullText - 当前文章全文（可为空）
 * @param {(chunk: string) => void} [onChunk] - 流式回调
 * @returns {Promise<string>} AI 回复文本
 */
async function chatStream(message, fullText, onChunk) {
  const systemPrompt = `你是中文阅读助教。用户正在阅读一篇文章，你可以结合文章内容回答问题。
当前文章内容：
"${fullText || ''}"

规则：
1. 回答要准确、有用。
2. 如果用户问与文章无关的问题，请礼貌告知你只能回答与阅读相关的问题。
3. 回复控制在 300 字以内。`;

  return await callDeepSeekStream(systemPrompt, message, onChunk);
}

module.exports = {
  explainLocalStream,
  summarizeStructureStream,
  generateHintStream,
  chatStream,
  callDeepSeek, // 非流式调用，兼容旧接口
};