// frontend/src/utils/api.js
// ==================== 后端 API 服务封装 ====================
// 所有与后端通信的接口调用统一在此定义, 使用 axios 发送请求
// 基础路径 /api 由 Vite 代理转发到后端 (见 vite.config.js)

import axios from 'axios'

// 创建 axios 实例
const apiClient = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

// ==================== 会话管理接口 ====================

/**
 * 创建阅读会话 (后端自动判断: 复用 active / 拒绝 completed / 新建)
 * @param {Object} params
 *   - student_code: 学生编号
 *   - article_id: 文章编号
 *   - question_id: 题目编号 (可选)
 *   - experiment_group: 实验分组 (可选)
 * @returns {Promise<{session_id, time_anchor, is_reused}>}
 */
export async function createSession(params) {
  const res = await apiClient.post('/session/create', {
    ...params,
    user_agent: navigator.userAgent,
  })
  return res.data
}

/**
 * 检查学生对某文章的会话状态
 * @param {string} studentCode - 学生编号
 * @param {number} articleId - 文章编号
 * @returns {Promise<{has_session, has_active, has_completed, can_start}>}
 */
export async function checkSession(studentCode, articleId) {
  const res = await apiClient.get(`/session/check/${studentCode}/${articleId}`)
  return res.data
}

/**
 * 结束阅读会话
 * @param {string} sessionId - 会话ID
 * @param {string} status - 结束状态: completed | abandoned
 * @param {string} calibrationQuality - 校准质量 (可选)
 */
export async function endSession(sessionId, status = 'completed', calibrationQuality = null) {
  const res = await apiClient.post('/session/end', {
    session_id: sessionId,
    status,
    calibration_quality: calibrationQuality,
  })
  return res.data
}

/**
 * 心跳上报 (前端每 30 秒调用一次)
 * 用于页面异常关闭时估算学习时长
 */
export async function heartbeatSession(sessionId) {
  const res = await apiClient.post('/session/heartbeat', {
    session_id: sessionId,
  })
  return res.data
}

/**
 * 使用 sendBeacon 结束会话 (页面卸载时专用, 保证请求发出)
 * sendBeacon 不支持自定义 Content-Type, 后端需兼容
 */
export function sendBeaconEndSession(sessionId, status = 'abandoned') {
  const payload = JSON.stringify({
    session_id: sessionId,
    status,
  })
  const blob = new Blob([payload], { type: 'application/json' })
  return navigator.sendBeacon('/api/session/end', blob)
}

// ==================== 答题记录接口 ====================

/**
 * 保存/更新答题记录
 * @param {Object} params
 *   - session_id, student_code, article_id, question_id
 *   - answer: 当前答案
 *   - answer_type: initial | final
 *   - timestamp: 事件时间戳
 *   - correct_answer: 正确答案 (可选)
 */
export async function saveAnswer(params) {
  const res = await apiClient.post('/answers/save', params)
  return res.data
}

/**
 * 获取某学生的所有答题记录 (按 article_id 分组, 用于刷新后恢复进度)
 * @param {string} studentCode - 学生编号
 * @returns {Promise<Object>} - { success, data: { [article_id]: [...answers] } }
 */
export async function getStudentAnswers(studentCode) {
  const res = await apiClient.get(`/answers/student/${studentCode}`)
  return res.data
}

// ==================== 行为时序日志接口 ====================

/**
 * 批量上传行为事件
 * @param {Array} events - 事件数组
 */
export async function uploadBehaviorEvents(events) {
  const res = await apiClient.post('/behavior/batch', { events })
  return res.data
}

/**
 * 上传单条行为事件
 * @param {Object} event - 单条事件
 */
export async function uploadSingleBehavior(event) {
  const res = await apiClient.post('/behavior/single', event)
  return res.data
}

// ==================== AI 交互记录接口 ====================

/**
 * 保存 AI 交互记录
 * @param {Object} params - AI交互完整数据
 */
export async function saveAIInteraction(params) {
  const res = await apiClient.post('/ai-interactions/save', params)
  return res.data
}

// ==================== 眼动追踪数据接口 ====================

/**
 * 批量上传眼动数据
 * @param {string} sessionId - 会话ID
 * @param {Array} dataPoints - 眼动数据数组
 */
export async function uploadEyeTrackingData(sessionId, dataPoints) {
  const res = await apiClient.post('/eye-tracking/batch', {
    session_id: sessionId,
    data_points: dataPoints,
  })
  return res.data
}

// ==================== 个人记录接口 ====================

/**
 * 获取个人学习记录 (统计 + 笔记 + 排行榜)
 * @param {string} studentCode - 学生编号
 */
export async function getProfile(studentCode) {
  const res = await apiClient.get(`/profile/${studentCode}`)
  return res.data
}

/**
 * 获取指定文章的笔记 + AI 对话记录 (用于重新进入时恢复)
 * @param {string} studentCode - 学生编号
 * @param {number|string} articleId - 文章编号
 * @returns {Promise<{success, data: {note_content, note_type, ai_chats:[]}}>}
 */
export async function getArticleRecords(studentCode, articleId) {
  const res = await apiClient.get(`/profile/${studentCode}/records/${articleId}`)
  return res.data
}

// ==================== 数据导出接口 (仅管理员) ====================

/**
 * 管理员导出全部参与者实验数据 (CSV)
 * @param {string} adminCode - 管理员编号 (test)
 */
export function exportAllDataCSV(adminCode) {
  window.open(`/api/export/admin/all?student_code=${encodeURIComponent(adminCode)}`, '_blank')
}

/**
 * 管理员导出单个学生的全部实验数据 (CSV)
 * @param {string} adminCode - 管理员编号
 * @param {string} targetCode - 目标学生编号
 */
export function exportStudentCSV(adminCode, targetCode) {
  window.open(`/api/export/admin/student/${encodeURIComponent(targetCode)}?student_code=${encodeURIComponent(adminCode)}`, '_blank')
}

export default apiClient
