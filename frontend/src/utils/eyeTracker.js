// frontend/src/utils/eyeTracker.js
// ==================== 眼动追踪管理器 ====================
// 基于 WebGazer.js 实现浏览器端眼动追踪, 不可用时降级为鼠标追踪
// 职责:
//   1. 动态加载 WebGazer.js (CDN)
//   2. 启动/停止眼动追踪
//   3. 注册 AOI (兴趣区域) 元素, 检测注视区域
//   4. 采集注视数据点, 通过回调推送给 tracker
//   5. 监测数据缺失 (连续 N 秒无注视点)
//   6. 状态回调: eyeTracking -> idle / active / degraded
//
// 数据采集维度:
//   - aoi_type: reading(文章区) | question(题目区) | options(答题区) | ai_chat(AI区) | note(笔记标记区) | other
//   - fixation_duration_ms: 在该区域的注视时长 (毫秒)
//   - fixation_x / fixation_y: 注视坐标 (屏幕像素)
//   - transition_from: 切换来源区域
//   - transition_event: 是否为区域切换事件 (0/1)
//   - calibration_quality: good / fair / poor
//   - data_missing: 数据缺失标记 (0/1)

const WEBGAZER_URL = 'https://cdn.jsdelivr.net/npm/webgazer@2.0.1/dist/webgazer.js'

// AOI 类型常量
export const AOI_TYPES = {
  READING: 'reading',
  QUESTION: 'question',
  OPTIONS: 'options',
  AI_CHAT: 'ai_chat',
  NOTE: 'note',
  OTHER: 'other'
}

class EyeTrackerManager {
  constructor() {
    this.webgazer = null
    this.isLoaded = false
    this.isActive = false
    this.mode = 'idle'        // 'idle' | 'webgazer' | 'mouse'
    this.calibrationQuality = null  // 'good' | 'fair' | 'poor' | null

    // AOI 注册表: { [aoiType]: { el, rect } }
    this.aoiRegistry = {}

    // 注视状态追踪
    this.currentAoi = null      // 当前注视区域
    this.currentAoiSince = 0    // 进入当前区域的时间戳
    this.lastGazeTime = 0       // 最后一次收到注视点的时间
    this.lastDataPushTime = 0   // 最后一次推送数据的时间
    this.dataMissingChecked = false

    // 回调
    this.onDataCallback = null  // 数据推送回调 (推给 tracker.pushEyeTrackingData)
    this.onStatusChange = null  // 状态变化回调 (推给 Vue 响应式状态)

    // 定时器
    this.gazeInterval = null
    this.missingCheckInterval = null

    // 鼠标降级模式
    this.mouseHandler = null

    // 数据推送节流 (避免高频推送导致卡顿)
    this.pushIntervalMs = 2000   // 每 2 秒推送一次当前区域的注视数据
    this.missingThresholdMs = 5000  // 连续 5 秒无注视点 = 数据缺失
    this.aoiMinDurationMs = 300     // 在某区域停留超过 300ms 才算有效注视
  }

  // ==================== 动态加载 WebGazer ====================

  /**
   * 动态加载 WebGazer.js 脚本 (CDN)
   * @returns {Promise<boolean>} true 表示加载成功且 window.webgazer 可用
   */
  async loadWebGazer() {
    if (this.isLoaded) return true

    return new Promise((resolve) => {
      const script = document.createElement('script')
      script.src = WEBGAZER_URL
      script.async = true

      script.onload = () => {
        if (window.webgazer) {
          this.webgazer = window.webgazer
          this.isLoaded = true
          console.log('[EyeTracker] WebGazer.js 加载成功')
          resolve(true)
        } else {
          console.warn('[EyeTracker] WebGazer.js 加载但 window.webgazer 不存在')
          resolve(false)
        }
      }

      script.onerror = () => {
        console.warn('[EyeTracker] WebGazer.js CDN 加载失败, 降级为鼠标追踪')
        resolve(false)
      }

      document.head.appendChild(script)
    })
  }

  // ==================== 启动校准 ====================

  /**
   * 启动校准流程: 优先加载 WebGazer, 不可用时降级为鼠标追踪
   * @param {HTMLElement} [videoElement] - 可选的视频元素 (当前未使用, 预留)
   * @returns {Promise<{mode: string, success: boolean}>} mode 为 'webgazer' 或 'mouse'
   */
  async startCalibration(videoElement = null) {
    const loaded = await this.loadWebGazer()

    if (loaded && this.webgazer) {
      try {
        // 配置 WebGazer: 不显示内部 UI, 不存储预测数据
        this.webgazer
          .setRegression('ridge')
          .setTracker('TFFacemesh')
          .showVideo(false)
          .showPredictionPoints(false)
          .showFaceOverlay(false)
          .showFaceFeedbackBox(false)

        // 开始校准
        await this.webgazer.begin()

        // 隐藏 WebGazer 自动创建的视频元素
        this._hideWebGazerVideoElements()

        console.log('[EyeTracker] WebGazer 校准模式已启动')
        return { mode: 'webgazer', success: true }
      } catch (err) {
        console.warn('[EyeTracker] WebGazer 启动失败, 降级为鼠标追踪:', err)
      }
    }

    // 降级: 鼠标模式
    this.mode = 'mouse'
    console.log('[EyeTracker] 使用鼠标追踪模式 (降级)')
    return { mode: 'mouse', success: true }
  }

  // ==================== 校准点点击回调 ====================

  /**
   * 校准点点击回调: 告知 WebGazer 用户当前注视的屏幕位置
   * @param {number} x - 屏幕横坐标 (像素)
   * @param {number} y - 屏幕纵坐标 (像素)
   * @param {number} index - 校准点序号 (未直接使用, 预留)
   */
  onCalibrationPoint(x, y, index) {
    if (this.mode === 'webgazer' && this.webgazer) {
      // 告诉 WebGazer 在该位置进行校准
      // WebGazer 的 recordScreenPosition 会记录用户的注视位置
      this.webgazer.recordScreenPosition(x, y, 'click')
    }
    // 鼠标模式无需额外操作
  }

  // ==================== 完成校准 ====================

  /**
   * 完成校准: 停止 WebGazer 校准模式并评估校准质量
   * @param {number} pointsCompleted - 用户完成的校准点数量
   * @returns {string} 校准质量评级: 'good' (≥5点) | 'fair' (鼠标模式或<5点)
   */
  finishCalibration(pointsCompleted) {
    if (this.mode === 'webgazer' && this.webgazer) {
      // 停止校准模式, 保留回归模型
      try {
        this.webgazer.pause()
      } catch (e) {
        console.warn('[EyeTracker] WebGazer pause 失败:', e)
      }
    }

    // 评估校准质量
    if (this.mode === 'webgazer') {
      this.calibrationQuality = pointsCompleted >= 5 ? 'good' : 'fair'
    } else {
      this.calibrationQuality = 'fair'  // 鼠标模式标记为 fair
    }

    console.log('[EyeTracker] 校准完成, 质量:', this.calibrationQuality, '模式:', this.mode)
    return this.calibrationQuality
  }

  // ==================== 启动追踪 (做题时) ====================

  /**
   * 启动眼动追踪: 注册注视回调, 启动定时推送与缺失检测
   * @param {Function} onData - 数据推送回调, 参数为注视数据点对象
   * @param {Function} onStatusChange - 状态变化回调, 参数为 {status, mode, calibrationQuality}
   */
  async startTracking(onData, onStatusChange) {
    if (this.isActive) {
      console.warn('[EyeTracker] 已在运行中')
      return
    }

    this.onDataCallback = onData
    this.onStatusChange = onStatusChange
    this.isActive = true

    if (this.mode === 'webgazer' && this.webgazer) {
      try {
        this.webgazer.resume()
        // 注册注视回调
        this.webgazer.setGazeListener((data, elapsedTime) => {
          if (data) {
            this._processGaze(data.x, data.y)
          }
        })
        console.log('[EyeTracker] WebGazer 注视追踪已启动')
        this._notifyStatus('active')
      } catch (err) {
        console.warn('[EyeTracker] WebGazer resume 失败, 降级为鼠标追踪:', err)
        this._startMouseMode()
      }
    } else {
      this._startMouseMode()
    }

    // 启动定时推送 (节流: 每 pushIntervalMs 推送一次当前区域注视数据)
    this.gazeInterval = setInterval(() => {
      this._pushCurrentFixation()
    }, this.pushIntervalMs)

    // 启动数据缺失检测 (每 2 秒检查一次)
    this.missingCheckInterval = setInterval(() => {
      this._checkDataMissing()
    }, 2000)
  }

  // ==================== 停止追踪 ====================

  /** 停止眼动追踪: 清除定时器, 移除事件监听, 推送最后一条数据 */
  stopTracking() {
    this.isActive = false

    if (this.gazeInterval) {
      clearInterval(this.gazeInterval)
      this.gazeInterval = null
    }

    if (this.missingCheckInterval) {
      clearInterval(this.missingCheckInterval)
      this.missingCheckInterval = null
    }

    if (this.mode === 'webgazer' && this.webgazer) {
      try {
        this.webgazer.setGazeListener(null)
        this.webgazer.pause()
      } catch (e) {
        console.warn('[EyeTracker] WebGazer 停止失败:', e)
      }
    }

    if (this.mouseHandler) {
      document.removeEventListener('mousemove', this.mouseHandler)
      this.mouseHandler = null
    }

    // 推送最后一条数据
    this._pushCurrentFixation()

    this._notifyStatus('idle')
    console.log('[EyeTracker] 追踪已停止')
  }

  // ==================== 注册 AOI ====================

  /**
   * 注册兴趣区域 (AOI), 记录元素及其屏幕坐标范围
   * @param {string} aoiType - AOI 类型 (见 AOI_TYPES)
   * @param {HTMLElement} element - 对应的 DOM 元素
   */
  registerAoi(aoiType, element) {
    if (!element) return

    const rect = element.getBoundingClientRect()

    this.aoiRegistry[aoiType] = {
      el: element,
      rect: {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height
      }
    }
  }

  /**
   * 重新计算所有已注册 AOI 的屏幕坐标范围
   * 在窗口缩放或滚动后调用, 确保 AOI 检测准确
   */
  refreshAoiRects() {
    for (const [type, aoi] of Object.entries(this.aoiRegistry)) {
      if (aoi.el) {
        const rect = aoi.el.getBoundingClientRect()
        aoi.rect = {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        }
      }
    }
  }

  // ==================== 内部: 检测坐标属于哪个 AOI ====================

  _detectAoi(x, y) {
    for (const [type, aoi] of Object.entries(this.aoiRegistry)) {
      const r = aoi.rect
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return type
      }
    }
    return AOI_TYPES.OTHER
  }

  // ==================== 内部: 处理注视点 ====================

  _processGaze(x, y) {
    // 限制坐标范围
    if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) {
      return
    }

    this.lastGazeTime = Date.now()

    // 检测 AOI
    const detectedAoi = this._detectAoi(x, y)

    // 区域切换检测
    if (detectedAoi !== this.currentAoi) {
      // 推送上一个区域的注视数据
      if (this.currentAoi) {
        this._pushFixation(this.currentAoi, true)  // transition = true
      }

      // 记录新区域
      this.currentAoi = detectedAoi
      this.currentAoiSince = Date.now()
    }
  }

  // ==================== 内部: 推送当前注视数据 ====================

  _pushCurrentFixation() {
    if (!this.currentAoi) return

    const now = Date.now()
    const duration = now - this.currentAoiSince

    // 只推送超过最小注视时长的数据
    if (duration < this.aoiMinDurationMs) return

    this._pushFixation(this.currentAoi, false)
  }

  // ==================== 内部: 推送一条注视数据 ====================

  _pushFixation(aoiType, isTransition) {
    if (!this.onDataCallback) return

    const now = Date.now()
    const duration = now - (this.currentAoiSince || now)

    const dataPoint = {
      timestamp: now,
      aoi_type: aoiType,
      fixation_duration_ms: Math.round(duration),
      fixation_x: null,   // WebGazer 原始坐标已在 _processGaze 中使用, 这里不传
      fixation_y: null,
      transition_from: isTransition ? (this.currentAoi !== aoiType ? this.currentAoi : null) : null,
      transition_event: isTransition ? 1 : 0,
      calibration_quality: this.calibrationQuality,
      data_missing: 0
    }

    // 如果是切换事件, 更新当前区域起始时间
    if (isTransition) {
      this.currentAoi = aoiType
      this.currentAoiSince = now
    }

    this.lastDataPushTime = now
    this.onDataCallback(dataPoint)
  }

  // ==================== 内部: 数据缺失检测 ====================

  _checkDataMissing() {
    if (!this.isActive) return

    const now = Date.now()
    const timeSinceLastGaze = now - this.lastGazeTime

    // 如果超过阈值没有收到注视点, 推送一条缺失标记
    if (timeSinceLastGaze > this.missingThresholdMs && this.lastGazeTime > 0) {
      const dataPoint = {
        timestamp: now,
        aoi_type: AOI_TYPES.OTHER,
        fixation_duration_ms: null,
        fixation_x: null,
        fixation_y: null,
        transition_from: null,
        transition_event: 0,
        calibration_quality: this.calibrationQuality,
        data_missing: 1
      }

      if (this.onDataCallback) {
        this.onDataCallback(dataPoint)
      }

      this._notifyStatus('degraded')
    }
  }

  // ==================== 内部: 鼠标降级模式 ====================

  _startMouseMode() {
    this.mode = 'mouse'
    this._notifyStatus('active')

    this.mouseHandler = (event) => {
      this._processGaze(event.clientX, event.clientY)
    }

    document.addEventListener('mousemove', this.mouseHandler)
    console.log('[EyeTracker] 鼠标追踪已启动')
  }

  // ==================== 内部: 通知状态变化 ====================

  _notifyStatus(status) {
    if (this.onStatusChange) {
      this.onStatusChange({
        status,           // 'idle' | 'active' | 'degraded'
        mode: this.mode,  // 'webgazer' | 'mouse'
        calibrationQuality: this.calibrationQuality
      })
    }
  }

  // ==================== 内部: 隐藏 WebGazer 视频元素 ====================

  _hideWebGazerVideoElements() {
    // WebGazer 会自动创建 video/canvas 元素, 隐藏它们
    const style = document.createElement('style')
    style.textContent = `
      #webgazerVideoContainer { display: none !important; }
      #webgazerVideoFeed { display: none !important; }
      #webgazerVideoCanvas { display: none !important; }
      #webgazerFaceOverlay { display: none !important; }
      #webgazerFaceFeedbackBox { display: none !important; }
      #webgazerGazeDot { display: none !important; }
    `
    document.head.appendChild(style)
  }

  // ==================== 销毁 ====================

  /** 销毁追踪器: 停止追踪, 释放 WebGazer 资源, 清空 AOI 注册表 */
  destroy() {
    this.stopTracking()

    if (this.webgazer) {
      try {
        this.webgazer.end()
      } catch (e) {
        // ignore
      }
    }

    this.webgazer = null
    this.isLoaded = false
    this.aoiRegistry = {}
  }
}

// 导出单例
export const eyeTracker = new EyeTrackerManager()
