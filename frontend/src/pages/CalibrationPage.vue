<template>
  <div class="calibration-page">
    <!-- 顶部信息 -->
    <div class="cal-header">
      <h2>👁️ 眼动校准</h2>
      <p v-if="phase === 'loading'">正在加载眼动追踪引擎...</p>
      <p v-else-if="phase === 'instruction'">请注视并点击屏幕上的 <strong>5 个圆点</strong></p>
      <p v-else-if="phase === 'calibrating'">请注视并点击亮起的圆点 ({{ completedCount }} / 5)</p>
      <p v-else-if="phase === 'done'">✅ 校准完成！质量: <strong>{{ calibrationQuality }}</strong></p>
      <p v-if="trackingMode === 'mouse'" class="mode-hint">⚠️ 摄像头不可用，已切换为鼠标追踪模式</p>
    </div>

    <!-- 摄像头预览 (小窗) -->
    <div v-if="phase !== 'loading' && trackingMode === 'webgazer'" class="camera-preview" id="cameraPreviewContainer">
      <video id="cameraVideo" autoplay muted playsinline></video>
      <div class="camera-label">摄像头预览</div>
    </div>

    <!-- 校准点 -->
    <div class="cal-points-layer">
      <div
        v-for="(pt, idx) in points"
        :key="idx"
        class="cal-point"
        :class="{
          done: pt.done,
          active: phase === 'calibrating' && idx === nextPointIndex,
          dim: phase === 'calibrating' && idx !== nextPointIndex && !pt.done
        }"
        :style="pointStyle(idx)"
        @click="clickPoint(idx)"
      ></div>
    </div>

    <!-- 底部按钮 -->
    <div class="cal-footer">
      <button v-if="phase === 'instruction'" @click="startCalibration" class="cal-btn-primary">
        开始校准
      </button>
      <button v-if="phase === 'done'" @click="goToTask" class="cal-btn-success">
        ✅ 校准通过，开始阅读
      </button>
      <button v-if="phase === 'done' && completedCount < 5" @click="reset" class="cal-btn-secondary">
        重新校准
      </button>
    </div>
  </div>
</template>

<script setup>
/**
 * CalibrationPage.vue - 眼动校准页面
 *
 * 功能说明：
 *   - 加载眼动追踪引擎（WebGazer），加载失败时降级为鼠标追踪模式
 *   - 5 点校准流程：左上 → 右上 → 中心 → 左下 → 右下（按序点击）
 *   - 启用摄像头预览小窗（仅 WebGazer 模式）
 *   - 校准完成后记录质量评分，并跳转至阅读任务页
 *
 * 状态流转：
 *   loading -> instruction -> calibrating -> done
 *
 * 依赖：
 *   - eyeTracker：眼动追踪封装（初始化/记录校准点/完成校准）
 *   - tracker：行为事件日志记录
 */
import { ref, reactive, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { tracker } from '@/utils/tracker'
import { eyeTracker } from '@/utils/eyeTracker'

const router = useRouter()

// ==================== 状态 ====================
const phase = ref('loading')       // 校准阶段：'loading' -> 'instruction' -> 'calibrating' -> 'done'
const trackingMode = ref('')       // 追踪模式：'webgazer'（摄像头） | 'mouse'（降级）
const calibrationQuality = ref('') // 校准质量评分（由 eyeTracker 返回）

// 5 个校准点坐标（按校准顺序排列，x/y 为屏幕比例 0~1）
const points = reactive([
  { done: false, x: 0.1,  y: 0.15 },   // 左上
  { done: false, x: 0.9,  y: 0.15 },   // 右上
  { done: false, x: 0.5,  y: 0.5  },   // 中心
  { done: false, x: 0.1,  y: 0.8  },   // 左下
  { done: false, x: 0.9,  y: 0.8  }    // 右下
])

/** 已完成的校准点数量 */
const completedCount = computed(() => points.filter(p => p.done).length)
/** 下一个待校准点的索引（全部完成时为 -1） */
const nextPointIndex = computed(() => points.findIndex(p => !p.done))

// ==================== 校准点位置 ====================
/**
 * 计算校准点的绝对定位样式。
 * @param {number} idx - 校准点索引（0~4）
 * @returns {{left: string, top: string}} 用于 :style 绑定的定位样式
 */
const pointStyle = (idx) => {
  const pt = points[idx]
  return {
    left: `${pt.x * 100}%`,
    top: `${pt.y * 100}%`
  }
}

// ==================== 初始化 ====================
/**
 * 页面挂载时加载眼动引擎并初始化摄像头预览。
 * 先调用 eyeTracker 启动校准引擎，再根据返回的追踪模式决定是否启用摄像头。
 * @async
 * @returns {Promise<void>}
 */
onMounted(async () => {
  // 动态加载 WebGazer 引擎并获取可用追踪模式
  const result = await eyeTracker.startCalibration()
  trackingMode.value = result.mode

  // 先切换到 instruction, 让模板渲染出 video 元素
  phase.value = 'instruction'

  // 如果是 WebGazer 模式, 等待 DOM 渲染后启动摄像头预览
  if (result.mode === 'webgazer') {
    await nextTick()
    await startCameraPreview()
  }
})

// ==================== 摄像头预览 ====================
/**
 * 启动摄像头预览并绑定到 video 元素。
 * 仅用于预览展示，不影响 WebGazer 自身的摄像头采集。
 * 失败时仅告警不抛错，避免因预览不可用而降级为鼠标模式。
 * @async
 * @returns {Promise<void>}
 */
async function startCameraPreview() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240 },
      audio: false
    })
    const video = document.getElementById('cameraVideo')
    if (video) {
      video.srcObject = stream
      // 确保 video 开始播放
      await video.play().catch(() => {})
    } else {
      // 拿到流但 video 元素不存在, 释放流
      stream.getTracks().forEach(t => t.stop())
    }
  } catch (err) {
    // 预览失败仅告警，不阻断校准流程（WebGazer 仍可独立工作）
    console.warn('[Calibration] getUserMedia 失败:', err)
  }
}

// ==================== 开始校准 ====================
/**
 * 开始校准流程：重置所有校准点状态并进入 calibrating 阶段。
 */
function startCalibration() {
  // 重置所有点
  points.forEach(p => p.done = false)
  phase.value = 'calibrating'
}

// ==================== 点击校准点 ====================
/**
 * 处理校准点点击事件。
 * 仅允许按顺序点击当前高亮点；点击后将屏幕坐标传给 eyeTracker 记录，
 * 并通过 tracker 记录行为事件，全部完成后触发完成流程。
 * @param {number} idx - 被点击的校准点索引
 */
function clickPoint(idx) {
  if (phase.value !== 'calibrating') return
  if (points[idx].done) return

  // 只允许按顺序点击当前高亮点
  if (idx !== nextPointIndex.value) return

  points[idx].done = true

  // 获取圆点的屏幕坐标（比例坐标 -> 像素坐标）
  const pt = points[idx]
  const screenX = pt.x * window.innerWidth
  const screenY = pt.y * window.innerHeight

  // 通知 eyeTracker 记录校准点
  eyeTracker.onCalibrationPoint(screenX, screenY, idx)

  // 记录行为事件
  tracker.logEvent('CALIBRATION_POINT', {
    point_index: idx,
    screen_x: Math.round(screenX),
    screen_y: Math.round(screenY),
    mode: trackingMode.value
  })

  // 检查是否全部完成
  if (completedCount.value === 5) {
    finishCalibration()
  }
}

// ==================== 完成校准 ====================
/**
 * 完成校准：获取质量评分、记录完成事件并进入 done 阶段。
 */
function finishCalibration() {
  const quality = eyeTracker.finishCalibration(5)
  calibrationQuality.value = quality

  tracker.logEvent('CALIBRATION_COMPLETE', {
    quality: quality,
    points_completed: 5,
    mode: trackingMode.value
  })

  phase.value = 'done'
}

// ==================== 重新校准 ====================
/**
 * 重置校准状态，重新进入 calibrating 阶段。
 */
function reset() {
  points.forEach(p => p.done = false)
  phase.value = 'calibrating'
  calibrationQuality.value = ''
}

// ==================== 进入做题 ====================
/**
 * 跳转至阅读任务页，离开前释放摄像头资源。
 */
function goToTask() {
  // 停止摄像头预览
  const video = document.getElementById('cameraVideo')
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop())
  }
  router.push('/task')
}

// ==================== 页面卸载 ====================
/**
 * 页面卸载时释放摄像头流，避免摄像头指示灯常亮。
 */
onUnmounted(() => {
  // 停止摄像头
  const video = document.getElementById('cameraVideo')
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop())
  }
})
</script>

<style scoped>
.calibration-page {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #1a1a2e;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  overflow: hidden;
}

.cal-header {
  margin-top: 40px;
  text-align: center;
  z-index: 10;
}
.cal-header h2 {
  font-size: 1.8rem;
  font-weight: 700;
  color: #ffffff;
  margin-bottom: 8px;
}
.cal-header p {
  color: #a0a0b8;
  font-size: 0.95rem;
}
.cal-header p .mode-hint {
  color: #fbbf24;
  margin-top: 6px;
}

/* 摄像头预览 (底部居中, 避开 5 个校准点) */
.camera-preview {
  position: fixed;
  bottom: 90px;
  left: 50%;
  transform: translateX(-50%);
  width: 160px;
  height: 120px;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid #3b82f6;
  z-index: 50;
  background: #000;
}
.camera-preview video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transform: scaleX(-1);  /* 镜像 */
}
.camera-label {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: rgba(0,0,0,0.6);
  color: #fff;
  font-size: 0.7rem;
  text-align: center;
  padding: 2px 0;
}

/* 校准点 */
.cal-points-layer {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}
.cal-point {
  position: absolute;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 3px solid #6b7280;
  background: rgba(107, 114, 128, 0.3);
  cursor: pointer;
  transform: translate(-50%, -50%);
  transition: all 0.2s;
  z-index: 20;
}
.cal-point.active {
  border-color: #3b82f6;
  background: #3b82f6;
  box-shadow: 0 0 20px rgba(59, 130, 246, 0.6);
  animation: pulse 1.2s infinite;
}
.cal-point.dim {
  opacity: 0.25;
}
.cal-point.done {
  border-color: #22c55e;
  background: #22c55e;
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.4);
}
.cal-point:hover.active {
  transform: translate(-50%, -50%) scale(1.15);
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 20px rgba(59, 130, 246, 0.6); }
  50% { box-shadow: 0 0 30px rgba(59, 130, 246, 0.9); }
}

/* 底部按钮 */
.cal-footer {
  position: fixed;
  bottom: 40px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  gap: 12px;
  z-index: 30;
}
.cal-btn-primary {
  padding: 12px 40px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 30px;
  font-size: 1.1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.cal-btn-primary:hover { background: #2563eb; }

.cal-btn-success {
  padding: 12px 40px;
  background: #22c55e;
  color: white;
  border: none;
  border-radius: 30px;
  font-size: 1.1rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.cal-btn-success:hover { background: #16a34a; }

.cal-btn-secondary {
  padding: 12px 28px;
  background: #6b7280;
  color: white;
  border: none;
  border-radius: 30px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
}
.cal-btn-secondary:hover { background: #4b5563; }
</style>
