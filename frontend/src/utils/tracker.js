// frontend/src/utils/tracker.js
// ==================== 行为采集工具 ====================
// 职责:
//   1. 管理会话上下文 (session_id, student_code, time_anchor)
//   2. 提供统一时间戳生成方法 (与眼动数据共用同一基准)
//   3. 累积行为事件, 定时批量上传到后端
//   4. 提供 AI 交互记录和眼动数据的转发方法
//
// 使用方式:
//   import { tracker } from '@/utils/tracker'
//   tracker.init(sessionId, studentCode, timeAnchor)
//   tracker.logEvent('ANSWER_MODIFY', { old_answer: 'A', new_answer: 'B' })
//   tracker.flush()  // 手动触发上传

import { uploadBehaviorEvents, uploadSingleBehavior, uploadEyeTrackingData, saveAIInteraction } from './api'

class BehaviorTracker {
  constructor() {
    // 会话上下文
    this.sessionId = null
    this.studentCode = null
    this.timeAnchor = null       // 服务器返回的统一时间锚点 (Unix epoch 毫秒)
    
    // 事件缓冲区 (累积事件, 达到阈值后批量上传)
    this.eventBuffer = []
    this.flushThreshold = 20    // 缓冲区达到 20 条事件时自动上传
    this.flushIntervalMs = 10000 // 每 10 秒定时上传一次
    this.flushTimer = null
    
    // 眼动数据缓冲区
    this.eyeDataBuffer = []
    this.eyeDataFlushThreshold = 50 // 眼动数据达到 50 条时自动上传
    this.eyeDataFlushTimer = null
    this.eyeDataFlushIntervalMs = 5000 // 眼动数据每 5 秒上传一次
  }

  /**
   * 初始化追踪器 (会话创建后调用)
   * @param {string} sessionId - 会话ID
   * @param {string} studentCode - 学生编号
   * @param {number} timeAnchor - 服务器统一时间锚点
   */
  init(sessionId, studentCode, timeAnchor) {
    this.sessionId = sessionId
    this.studentCode = studentCode
    this.timeAnchor = timeAnchor

    // 启动定时上传定时器
    this._startFlushTimers()

    console.log('[Tracker] 初始化完成, 会话:', sessionId, '时间锚点:', timeAnchor)
  }

  /**
   * 获取当前时间戳 (与服务器和眼动数据共用同一时间基准)
   * 使用 Date.now() 返回 Unix epoch 毫秒
   * @returns {number} 当前时间戳 (毫秒)
   */
  getTimestamp() {
    return Date.now()
  }

  /**
   * 记录行为事件 (放入缓冲区, 等待批量上传)
   * @param {string} eventType - 事件类型 (见 schema.sql 中的枚举说明)
   * @param {Object} eventData - 事件详细数据 (JSON对象)
   * @param {Object} context - 事件上下文 (article_id, question_id 等)
   */
  logEvent(eventType, eventData = null, context = {}) {
    if (!this.sessionId) {
      console.warn('[Tracker] 未初始化会话, 事件被丢弃:', eventType)
      return
    }

    const event = {
      session_id: this.sessionId,
      student_code: this.studentCode,
      event_type: eventType,
      event_timestamp: this.getTimestamp(),
      article_id: context.article_id || null,
      question_id: context.question_id || null,
      event_data: eventData,
    }

    this.eventBuffer.push(event)

    // 达到阈值自动上传
    if (this.eventBuffer.length >= this.flushThreshold) {
      this.flush()
    }
  }

  /**
   * 记录紧急事件 (立即上传, 不经过缓冲区)
   * @param {string} eventType - 事件类型
   * @param {Object} eventData - 事件详细数据
   * @param {Object} context - 事件上下文
   */
  async logEventImmediate(eventType, eventData = null, context = {}) {
    if (!this.sessionId) {
      console.warn('[Tracker] 未初始化会话, 事件被丢弃:', eventType)
      return
    }

    const event = {
      session_id: this.sessionId,
      student_code: this.studentCode,
      event_type: eventType,
      event_timestamp: this.getTimestamp(),
      article_id: context.article_id || null,
      question_id: context.question_id || null,
      event_data: eventData,
    }

    try {
      await uploadSingleBehavior(event)
    } catch (err) {
      console.error('[Tracker] 紧急事件上传失败:', err)
    }
  }

  /**
   * 上传缓冲区中的所有行为事件到后端
   */
  async flush() {
    if (this.eventBuffer.length === 0) return

    // 取出当前缓冲区内容, 清空缓冲区
    const events = [...this.eventBuffer]
    this.eventBuffer = []

    try {
      await uploadBehaviorEvents(events)
      console.log(`[Tracker] 已上传 ${events.length} 条行为事件`)
    } catch (err) {
      console.error('[Tracker] 批量上传失败, 事件放回缓冲区:', err)
      // 上传失败, 将事件放回缓冲区头部, 等待下次重试
      this.eventBuffer = [...events, ...this.eventBuffer]
    }
  }

  /**
   * 接收眼动设备推送的数据, 打上统一时间戳后放入缓冲区
   * @param {Object} eyeData - 眼动数据
   *   - aoi_type: 兴趣区域
   *   - fixation_duration_ms: 注视时长 (可选)
   *   - fixation_x, fixation_y: 注视坐标 (可选)
   *   - transition_from: 切换来源区域 (可选)
   *   - transition_event: 是否为切换事件 (可选)
   *   - calibration_quality: 校准质量 (可选)
   *   - data_missing: 数据缺失标记 (可选)
   *   - raw_data: 原始数据 (可选)
   *   - timestamp: 眼动设备原始时间戳 (可选, 若不传则使用当前时间)
   */
  pushEyeTrackingData(eyeData) {
    if (!this.sessionId) return

    const dataPoint = {
      ...eyeData,
      // 若眼动设备提供了时间戳则使用设备时间戳, 否则使用平台统一时间戳
      // 注意: 两者均为 Unix epoch 毫秒, 共用同一时间基准
      timestamp: eyeData.timestamp || this.getTimestamp(),
    }

    this.eyeDataBuffer.push(dataPoint)

    // 达到阈值自动上传
    if (this.eyeDataBuffer.length >= this.eyeDataFlushThreshold) {
      this.flushEyeTrackingData()
    }
  }

  /**
   * 批量上传眼动数据到后端
   */
  async flushEyeTrackingData() {
    if (this.eyeDataBuffer.length === 0 || !this.sessionId) return

    const dataPoints = [...this.eyeDataBuffer]
    this.eyeDataBuffer = []

    try {
      await uploadEyeTrackingData(this.sessionId, dataPoints)
      console.log(`[Tracker] 已上传 ${dataPoints.length} 条眼动数据`)
    } catch (err) {
      console.error('[Tracker] 眼动数据上传失败:', err)
      this.eyeDataBuffer = [...dataPoints, ...this.eyeDataBuffer]
    }
  }

  /**
   * 保存 AI 交互记录 (在收到 AI 完整回复后调用)
   * @param {Object} params - AI交互完整数据
   */
  async saveAIInteraction(params) {
    try {
      await saveAIInteraction({
        ...params,
        session_id: this.sessionId,
        student_code: this.studentCode,
      })
    } catch (err) {
      console.error('[Tracker] AI交互记录保存失败:', err)
    }
  }

  /**
   * 启动定时上传定时器
   */
  _startFlushTimers() {
    // 行为事件定时上传
    if (this.flushTimer) clearInterval(this.flushTimer)
    this.flushTimer = setInterval(() => {
      this.flush()
    }, this.flushIntervalMs)

    // 眼动数据定时上传
    if (this.eyeDataFlushTimer) clearInterval(this.eyeDataFlushTimer)
    this.eyeDataFlushTimer = setInterval(() => {
      this.flushEyeTrackingData()
    }, this.eyeDataFlushIntervalMs)
  }

  /**
   * 清理定时器并上传剩余数据 (页面卸载时调用)
   */
  async destroy() {
    if (this.flushTimer) clearInterval(this.flushTimer)
    if (this.eyeDataFlushTimer) clearInterval(this.eyeDataFlushTimer)

    // 上传所有剩余数据
    await this.flush()
    await this.flushEyeTrackingData()

    console.log('[Tracker] 已清理, 剩余数据已上传')
  }
}

// 导出单例实例
export const tracker = new BehaviorTracker()
