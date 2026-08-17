<template>
  <div class="reading-page">
    <!-- 顶部导航 -->
    <header class="top-nav">
      <div class="nav-content">
        <span class="brand">GenAI支持的L2中文阅读平台</span>
        <div class="stage-group">
          <div
            v-for="stage in stages"
            :key="stage.num"
            class="stage-indicator"
            :class="{
              active: currentStage === stage.num,
              completed: currentStage > stage.num,
              locked: currentStage < stage.num
            }"
          >
            <span class="stage-number">{{ stage.num }}</span>
            <span class="stage-label">{{ stage.label }}</span>
          </div>
        </div>
        <div class="timer-actions">
          <span class="timer">{{ taskTimer }}</span>
          <span class="eye-status-badge" :class="eyeStatusClass">
            <span class="eye-dot"></span>
            {{ eyeStatusText }}
          </span>
          <button @click="triggerImport" class="import-btn" title="导入题库 JSON">📂 导入</button>
          <button @click="goToProfile" class="profile-btn" title="查看个人学习记录">📊 查看记录</button>
          <input type="file" ref="fileInput" accept=".json" style="display: none" @change="handleImport" />
        </div>
      </div>
    </header>

    <!-- 主体 -->
    <main class="main-content">
      <!-- 左侧面板 -->
      <div class="left-panel">
        <!-- 答题卡 -->
        <div class="answer-card-trigger">
          <button @click="showAnswerCard = !showAnswerCard" class="answer-card-btn">📋 答题卡</button>
          <div v-if="showAnswerCard" class="answer-card-popup">
            <div class="answer-card-grid">
              <div
                v-for="(art, idx) in articles"
                :key="art.id"
                class="answer-card-item"
                :class="{
                  'completed': isArticleCompleted(art.id),
                  'active': currentArticleIndex === idx,
                  'unattempted': !isArticleCompleted(art.id) && currentArticleIndex !== idx
                }"
                @click="switchArticle(idx)"
              >
                {{ idx + 1 }}
              </div>
            </div>
            <div class="answer-card-legend">
              <span><span class="dot green"></span> 已完成</span>
              <span><span class="dot blue"></span> 当前</span>
              <span><span class="dot gray"></span> 未做</span>
            </div>
          </div>
        </div>

        <!-- 文章区域 -->
        <div class="article-wrapper" ref="aoiReadingRef">
          <div
            ref="articleContainer"
            class="article-container"
            v-html="renderedContent"
            @mouseup="handleMouseUp"
            @mousedown="handleMouseDown"
          ></div>
        </div>

        <!-- 题目区域 -->
        <div class="question-wrapper" ref="aoiQuestionRef">
          <div class="question-container">
            <div class="question-header">
              <h3 class="q-title">📝 题目 {{ currentQuestionIndex + 1 }}/{{ currentQuestions.length }}</h3>
              <div class="nav-buttons">
                <button @click="prevQuestion" :disabled="currentQuestionIndex === 0">← 上一题</button>
                <button @click="nextQuestion" :disabled="currentQuestionIndex === currentQuestions.length - 1">下一题 →</button>
              </div>
            </div>

            <p class="q-text">{{ currentQuestion.question }}</p>
            <div class="options-grid">
              <label
                v-for="(opt, idx) in currentQuestion.options"
                :key="idx"
                class="option-item"
                :class="{
                  selected: currentSelectedOptions[currentQuestionIndex] === opt,
                  correct: currentStage === 3 && opt === correctOptionText,
                  wrong: currentStage === 3 && opt === userSubmittedText && opt !== correctOptionText
                }"
              >
                <input
                  type="radio"
                  :value="opt"
                  v-model="currentSelectedOptions[currentQuestionIndex]"
                  :disabled="currentStage > 2"
                />
                {{ opt }}
              </label>
            </div>

            <!-- 阶段三: 显示解析 -->
            <div v-if="currentStage === 3 && currentQuestion.explanation" class="explanation-box">
              <div class="explanation-title">💡 解析</div>
              <p class="explanation-text">{{ currentQuestion.explanation }}</p>
            </div>

            <div class="button-group">
              <button
                v-if="currentStage === 1 && !sessionLocked"
                @click="saveAllAnswers"
                :disabled="!allQuestionsAnswered || saving"
                class="btn-primary"
              >
                {{ saving ? '保存中...' : '💾 保存所有答案' }}
              </button>
              <button
                v-if="currentStage === 2 && !sessionLocked"
                @click="submitAllAnswers"
                :disabled="!allQuestionsAnswered || submitting"
                class="btn-success"
              >
                {{ submitting ? '提交中...' : '📤 提交所有答案' }}
              </button>
              <button v-if="currentStage === 3 || sessionLocked" @click="goToProfile" class="btn-secondary">
                📊 查看个人记录
              </button>
            </div>

            <div class="stage-hint">
              <p v-if="sessionLocked" style="color: #dc2626; font-weight: 600;">🔒 该文章已完成阅读，不可重复答题</p>
              <p v-else-if="currentStage === 1">📌 阶段一：独立阅读，请先不要使用AI工具</p>
              <p v-else-if="currentStage === 2">🤖 阶段二：AI助手已解锁，可以提问了！</p>
              <p v-else-if="currentStage === 3">🎉 已完成！查看答案与解析</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧面板 -->
      <div class="right-panel">
        <div class="ai-container" ref="aoiAiChatRef">
          <div class="ai-buttons">
            <button class="ai-btn" @click="handleAI('sentence')" @mousedown.prevent :disabled="currentStage < 2">📖 理解句子</button>
            <button class="ai-btn" @click="handleAI('passage')" :disabled="currentStage < 2">📄 分析文段</button>
            <button class="ai-btn" @click="handleAI('hint')" :disabled="currentStage < 2 || hintStep > 3">💡 给个提示</button>
          </div>

          <div class="scrollable-area">
            <div class="chat-area">
              <div class="chat-messages" ref="chatMessages">
                <div v-for="(msg, idx) in currentChatHistory" :key="idx" class="chat-msg-wrapper">
                  <div class="chat-msg" :class="msg.role">
                    <strong>{{ msg.role === 'user' ? '我' : 'AI' }}：</strong>
                    <span>{{ msg.content }}</span>
                  </div>
                  <!-- AI 消息操作按钮 -->
                  <div v-if="msg.role === 'ai' && msg.content !== '...' && !msg.content.startsWith('❌')" class="msg-actions">
                    <button @click="addToNote(msg.content)" class="action-btn" title="加入笔记">📝 加入笔记</button>
                    <button v-if="msg.aiType === 'sentence'" @click="scrollToSelectedText(msg)" class="action-btn" title="返回原文">🔙 返回原文</button>
                    <button v-if="msg.aiType === 'passage' && currentArticle.mindmap" @click="showMindmapModal = true" class="action-btn" title="查看思维导图">🧠 查看思维导图</button>
                  </div>
                </div>
                <div v-if="aiLoading" class="chat-msg ai"><em>AI正在思考...</em></div>
              </div>
              <div class="chat-input-area">
                <div v-if="currentStage === 1" class="stage-lock-hint">🔒 保存所有答案后解锁AI辅助功能</div>
                <template v-else>
                  <input v-model="userInput" placeholder="请输入您的问题..." @keyup.enter="sendMessage" />
                  <button @click="sendMessage" :disabled="!userInput.trim() || aiLoading">发送</button>
                </template>
              </div>
            </div>

            <!-- 资源区域（背景视频） -->
            <div v-if="currentStage >= 2" class="resource-area">
              <div v-if="currentArticle.video" class="resource-item">
                <button @click="showVideo = !showVideo" class="resource-toggle">
                  🎬 背景视频 {{ showVideo ? '收起' : '展开' }}
                </button>
                <div v-if="showVideo" class="resource-content">
                  <video controls class="video-player" :src="currentArticle.video"></video>
                </div>
              </div>
            </div>

            <!-- 笔记区域 -->
            <div class="note-area" ref="aoiNoteRef">
              <div class="note-header">
                <span>📓 我的笔记</span>
                <span class="note-count">{{ currentNoteContent.length }} 字</span>
              </div>
              <textarea v-model="currentNoteContent" placeholder="记录你的思考..." rows="4"></textarea>

              <div class="marks-list" v-if="currentMarks.length > 0">
                <div class="marks-header">📌 标记列表</div>
                <div v-for="mark in currentMarks" :key="mark.id" class="mark-item">
                  <div class="mark-text">
                    <span :class="mark.type === 'highlight' ? 'mark-highlight' : 'mark-underline'">
                      {{ mark.text }}
                    </span>
                    <span class="mark-type">{{ mark.type === 'highlight' ? '🟡' : '🔽' }}</span>
                    <button @click="removeMark(mark.id)" class="mark-delete">✕</button>
                  </div>
                  <div class="mark-note">
                    <input
                      type="text"
                      :value="mark.note"
                      @input="updateMarkNote(mark.id, $event.target.value)"
                      placeholder="添加笔记..."
                      class="mark-note-input"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>

    <!-- 浮动工具栏 -->
    <div
      v-if="showToolbar"
      class="floating-toolbar"
      :style="{ top: toolbarY + 'px', left: toolbarX + 'px' }"
      @mousedown.stop
    >
      <button @click="applyMark('highlight')" class="toolbar-btn">🟡 标黄</button>
      <button @click="applyMark('underline')" class="toolbar-btn">🔽 下划线</button>
      <button @click="closeToolbar" class="toolbar-btn close-btn">✕</button>
    </div>

    <!-- 思维导图模态框 -->
    <div v-if="showMindmapModal" class="modal-overlay" @click="showMindmapModal = false">
      <div class="modal-content" @click.stop>
        <button class="modal-close" @click="showMindmapModal = false">✕</button>
        <h3>🧠 思维导图</h3>
        <img :src="currentArticle.mindmap" alt="思维导图" class="mindmap-modal-image" />
      </div>
    </div>
  </div>
</template>

<script setup>
/**
 * ReadingTaskPage — 阅读实验核心页面
 *
 * 职责：
 *  - 加载题库（服务器优先，降级到本地默认题库）
 *  - 管理三阶段阅读流程：阶段1 独立初读 → 阶段2 AI辅助 → 阶段3 答案与解析
 *  - 每篇文章独立维护答题进度（progressMap）、笔记、标记、AI 对话历史
 *  - 会话管理：切换文章时创建/复用后端 session，心跳保活，卸载时收尾
 *  - 数据采集：通过 tracker 上报行为事件（答题、标记、AI 交互、阶段切换等）
 *  - 眼动追踪：注册 AOI 区域，采集注视数据，页面隐藏时暂停
 *  - 计时器：记录每篇文章的有效学习时长，扣除后台暂停时间
 *  - 进度恢复：从后端恢复已保存/已提交的答案、笔记和 AI 对话
 */
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '../stores/useAuthStore'
// 默认题库作为降级方案
import { ARTICLES as DEFAULT_ARTICLES } from '../utils/constants'
// 数据采集工具和后端 API
import { tracker } from '../utils/tracker'
import { eyeTracker, AOI_TYPES } from '../utils/eyeTracker'
import { createSession, endSession, heartbeatSession, sendBeaconEndSession, saveAnswer, getStudentAnswers, getArticleRecords } from '../utils/api'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()

// ==================== 会话上下文 ====================
// 会话创建后存储 session_id, 供 tracker 和 API 调用使用
// 切换文章时会结束旧会话并创建新会话 (见 ensureSessionForCurrentArticle)
const sessionId = ref(null)

// ==================== 眼动追踪 ====================
// AOI 区域 refs (template 中用 ref 绑定)
const aoiReadingRef = ref(null)
const aoiQuestionRef = ref(null)
const aoiAiChatRef = ref(null)
const aoiNoteRef = ref(null)

// 眼动状态 (做题界面顶部的 "眼动有效" 徽章)
const eyeStatus = ref('idle')  // 'idle' | 'active' | 'degraded'
const eyeStatusText = computed(() => {
  if (eyeStatus.value === 'active') return '眼动有效'
  if (eyeStatus.value === 'degraded') return '眼动信号弱'
  return '眼动未启动'
})
const eyeStatusClass = computed(() => ({
  'eye-active': eyeStatus.value === 'active',
  'eye-degraded': eyeStatus.value === 'degraded',
  'eye-idle': eyeStatus.value === 'idle'
}))

// ==================== 题库管理 ========================
const articles = ref([])
const fileInput = ref(null)

/**
 * 从服务器加载题库列表。
 * 优先从 /api/articles 获取；失败时降级到本地默认题库。
 * 加载完成后初始化所有文章的进度结构。
 * @returns {Promise<void>}
 */
const loadArticlesFromServer = async () => {
  try {
    const res = await fetch('/api/articles')
    const result = await res.json()
    if (result.success && result.data && result.data.length > 0) {
      articles.value = result.data
    } else {
      articles.value = DEFAULT_ARTICLES
    }
  } catch (err) {
    console.warn('从服务器加载题库失败，使用默认题库', err)
    articles.value = DEFAULT_ARTICLES
  }
  initializeAllProgress()
  if (currentArticleIndex.value >= articles.value.length) {
    currentArticleIndex.value = 0
  }
}

/**
 * 从后端恢复答题进度。
 *
 * 查询该学生的所有答题记录，按文章分组恢复到 progressMap：
 *  - 有 final_answer 的题目 → 恢复到阶段3（已提交）
 *  - 有 initial_answer 的题目 → 恢复到阶段2（已保存）
 *
 * 同时恢复每篇文章的笔记内容、文本标记（高亮/下划线）和 AI 对话历史。
 * 刷新页面后不丢失之前的答题状态。
 *
 * @returns {Promise<void>}
 */
const restoreProgressFromBackend = async () => {
  try {
    const result = await getStudentAnswers(authStore.user_code)
    if (!result.success || !result.data) return

    const articleAnswers = result.data // { "1": [...], "2": [...] }

    for (const [articleIdStr, answers] of Object.entries(articleAnswers)) {
      const articleId = parseInt(articleIdStr)
      const art = articles.value.find(a => a.id === articleId)
      if (!art || !art.questions) continue

      const qCount = art.questions.length
      const progress = {
        stage: 1,
        selectedOptions: Array(qCount).fill(''),
        initialAnswers: Array(qCount).fill(null),
        submittedAnswers: Array(qCount).fill(null),
        noteContent: '',
        marks: [],
        chatHistory: [],
        completed: false
      }

      let hasFinal = false
      let hasInitial = false

      for (const ans of answers) {
        const qIdx = art.questions.findIndex(q => (q.id || 0) === ans.question_id)
        if (qIdx === -1) continue

        // 恢复选中的答案
        if (ans.final_answer) {
          progress.selectedOptions[qIdx] = ans.final_answer
          progress.submittedAnswers[qIdx] = ans.final_answer
          progress.initialAnswers[qIdx] = ans.initial_answer || ans.final_answer
          hasFinal = true
        } else if (ans.initial_answer) {
          progress.selectedOptions[qIdx] = ans.initial_answer
          progress.initialAnswers[qIdx] = ans.initial_answer
          hasInitial = true
        }
      }

      // 设置阶段
      if (hasFinal) {
        progress.stage = 3
        progress.completed = true
      } else if (hasInitial) {
        progress.stage = 2
      }

      progressMap.value[articleId] = progress
    }

    // ==================== 恢复笔记和 AI 对话 ====================
    // 对每篇有答题记录的文章，调用 getArticleRecords 获取笔记和对话
    for (const [articleIdStr] of Object.entries(articleAnswers)) {
      const articleId = parseInt(articleIdStr)
      try {
        const recordsRes = await getArticleRecords(authStore.user_code, articleId)
        if (recordsRes.success && recordsRes.data) {
          const prog = progressMap.value[articleId]
          if (prog) {
            // 恢复笔记内容
            if (recordsRes.data.note_content) {
              prog.noteContent = recordsRes.data.note_content
            }
            // 恢复标记 (标黄/下划线) + 关联笔记
            if (recordsRes.data.marks && recordsRes.data.marks.length > 0) {
              prog.marks = recordsRes.data.marks.map((m, idx) => ({
                id: m.mark_id || `restored_${idx}_${Date.now()}`,
                text: m.text,
                type: m.type,
                note: m.note || '',
                timestamp: Date.now()
              }))
            }
            // 恢复 AI 对话历史
            if (recordsRes.data.ai_chats && recordsRes.data.ai_chats.length > 0) {
              const chats = recordsRes.data.ai_chats
              const restored = []
              for (const chat of chats) {
                restored.push({ role: 'user', content: chat.user_question })
                restored.push({ role: 'ai', content: chat.ai_response, aiType: chat.ai_module })
              }
              prog.chatHistory = restored
            }
          }
        }
      } catch (err) {
        console.warn(`[Restore] 恢复文章 ${articleId} 的笔记/对话失败:`, err)
      }
    }

    console.log('[Restore] 已从后端恢复答题进度 + 笔记 + AI对话')
  } catch (err) {
    console.warn('[Restore] 从后端恢复进度失败:', err)
  }
}

const triggerImport = () => { fileInput.value.click() }

/**
 * 处理题库 JSON 文件导入。
 * 校验文件格式后 POST 到 /api/articles，成功后重新加载题库并重置进度。
 * @param {Event} event - 文件输入 change 事件
 */
const handleImport = async (event) => {
  const file = event.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result)
      if (!Array.isArray(data) || data.length === 0) {
        alert('无效的题库格式：必须是非空数组')
        return
      }
      const first = data[0]
      if (!first.id || !first.title || !first.content || !Array.isArray(first.questions)) {
        alert('题库结构错误：缺少 id, title, content 或 questions 字段')
        return
      }
      const res = await fetch('/api/articles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ articles: data })
      })
      const result = await res.json()
      if (result.success) {
        alert(`✅ 成功导入 ${data.length} 篇文章！`)
        await loadArticlesFromServer()
        currentArticleIndex.value = 0
        progressMap.value = {}
      } else {
        alert('导入失败：' + (result.message || '未知错误'))
      }
    } catch (error) {
      alert('解析 JSON 失败：' + error.message)
    }
  }
  reader.readAsText(file)
  event.target.value = ''
}

// ==================== 文章与进度管理 ========================
const currentArticleIndex = ref(0)
const progressMap = ref({})

const currentArticle = computed(() => {
  if (articles.value.length === 0) {
    return { id: 0, title: '加载中...', content: '<p>暂无文章，请导入题库</p>', questions: [], video: null, mindmap: null }
  }
  return articles.value[currentArticleIndex.value] || articles.value[0]
})
const currentQuestions = computed(() => currentArticle.value.questions || [])

/**
 * 初始化所有文章的进度结构（首次加载题库时调用）。
 * 为每篇文章创建默认的空进度对象，若已存在则跳过。
 */
const initializeAllProgress = () => {
  articles.value.forEach(art => {
    const id = art.id
    if (!progressMap.value[id]) {
      const qCount = art.questions ? art.questions.length : 0
      progressMap.value[id] = {
        stage: 1,
        selectedOptions: Array(qCount).fill(''),
        initialAnswers: Array(qCount).fill(null),
        submittedAnswers: Array(qCount).fill(null),
        noteContent: '',
        marks: [],
        chatHistory: [],
        completed: false
      }
    }
  })
}

/**
 * 获取当前文章的进度对象。
 * 若 progressMap 中不存在则惰性创建。
 * @returns {object} 当前文章的进度对象
 */
const getCurrentProgress = () => {
  const id = currentArticle.value.id
  if (!progressMap.value[id]) {
    const qCount = currentQuestions.value.length
    progressMap.value[id] = {
      stage: 1,
      selectedOptions: Array(qCount).fill(''),
      initialAnswers: Array(qCount).fill(null),
      submittedAnswers: Array(qCount).fill(null),
      noteContent: '',
      marks: [],
      chatHistory: [],
      completed: false
    }
  }
  return progressMap.value[id]
}

const currentProgress = computed({
  get: () => getCurrentProgress(),
  set: (val) => {
    const id = currentArticle.value.id
    progressMap.value[id] = val
  }
})

// 基于当前文章的进度判断是否已锁定（已完成的文章禁止再次答题）
// completed === true 且 stage === 3 时锁定
const sessionLocked = computed(() => {
  const p = currentProgress.value
  return p.completed === true && p.stage === 3
})

const currentStage = computed({
  get: () => currentProgress.value.stage,
  set: (val) => { currentProgress.value.stage = val }
})
const currentSelectedOptions = computed({
  get: () => currentProgress.value.selectedOptions,
  set: (val) => { currentProgress.value.selectedOptions = val }
})
const currentInitialAnswers = computed({
  get: () => currentProgress.value.initialAnswers,
  set: (val) => { currentProgress.value.initialAnswers = val }
})
const currentSubmittedAnswers = computed({
  get: () => currentProgress.value.submittedAnswers,
  set: (val) => { currentProgress.value.submittedAnswers = val }
})
const currentNoteContent = computed({
  get: () => currentProgress.value.noteContent,
  set: (val) => { currentProgress.value.noteContent = val }
})
const currentMarks = computed({
  get: () => currentProgress.value.marks || [],
  set: (val) => { currentProgress.value.marks = val }
})

// 每篇文章独立保存对话历史, 切换文章时自动切换
const currentChatHistory = computed({
  get: () => currentProgress.value.chatHistory || [],
  set: (val) => { currentProgress.value.chatHistory = val }
})

const currentQuestionIndex = ref(0)
const currentQuestion = computed(() => currentQuestions.value[currentQuestionIndex.value] || {})

// 阶段三答案匹配
const correctOptionText = computed(() => {
  const q = currentQuestion.value
  if (!q || !q.correctAnswer || !q.options) return ''
  const letter = q.correctAnswer.trim().toUpperCase()
  const found = q.options.find(opt => opt.trim().startsWith(letter + '.'))
  return found || ''
})
const userSubmittedText = computed(() => {
  const idx = currentQuestionIndex.value
  let answer = currentSubmittedAnswers.value[idx]
  if (!answer) return ''
  const q = currentQuestion.value
  if (q && q.options) {
    if (q.options.includes(answer)) return answer
    const found = q.options.find(opt => opt.trim().startsWith(answer.trim() + '.'))
    return found || answer
  }
  return answer
})

const allQuestionsAnswered = computed(() => {
  return currentSelectedOptions.value.every(opt => opt && opt.length > 0)
})

const isArticleCompleted = (articleId) => {
  const p = progressMap.value[articleId]
  if (!p) return false
  return p.stage === 3 && p.submittedAnswers.some(a => a !== null && a !== '')
}

/**
 * 切换到指定文章。
 *
 * 采集文章切换事件，重置题目索引、提示步数和选中文本，
 * 然后为新文章创建/复用会话（已完成文章除外）。
 * 如果文章没有恢复出的对话记录，添加欢迎消息。
 *
 * @param {number} index - 目标文章在 articles 数组中的索引
 * @returns {Promise<void>}
 */
const switchArticle = async (index) => {
  if (index === currentArticleIndex.value) {
    showAnswerCard.value = false
    return
  }
  // 采集文章切换事件
  tracker.logEvent('ARTICLE_SWITCH', {
    from_article_id: currentArticle.value.id,
    to_article_id: articles.value[index]?.id,
    from_index: currentArticleIndex.value,
    to_index: index
  })
  currentArticleIndex.value = index
  currentQuestionIndex.value = 0
  hintStep.value = 1
  selectedText.value = ''
  showAnswerCard.value = false
  showMindmapModal.value = false

  // 为新文章创建/复用会话 (已完成文章除外)
  await ensureSessionForCurrentArticle()

  // 如果当前文章没有恢复出对话记录, 添加欢迎消息
  if (currentChatHistory.value.length === 0) {
    currentChatHistory.value = []
    addChatMessage('ai', '你好！我是AI阅读助手。你可以点击上方按钮获取帮助，或在下方提问。')
  }
}

// ==================== 标记功能（高亮/下划线） ========================
const articleContainer = ref(null)
const showToolbar = ref(false)
const toolbarX = ref(0)
const toolbarY = ref(0)
let selectedRange = null
const selectedText = ref('')

/**
 * 渲染文章内容时应用标记样式。
 *
 * 将 currentMarks 中的高亮/下划线标记注入到文章 HTML 中：
 *  - 按文本长度降序排列，避免短文本先替换导致长文本匹配失败
 *  - 用正则全局替换，将标记文本包裹在带 data-mark-id 的 span 中
 */
const renderedContent = computed(() => {
  let html = currentArticle.value.content || ''
  const marks = currentMarks.value || []
  // 按文本长度降序排列，避免短文本先替换导致长文本匹配失败
  const sortedMarks = [...marks].sort((a, b) => b.text.length - a.text.length)
  for (const mark of sortedMarks) {
    const className = mark.type === 'highlight' ? 'highlight-yellow' : 'underline-text'
    const replacement = `<span class="${className}" data-mark-id="${mark.id}">${mark.text}</span>`
    html = html.replace(new RegExp(mark.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replacement)
  }
  return html
})

watch(() => currentArticle.value.id, () => {
  showToolbar.value = false
})

/**
 * 鼠标抬起时检测是否有选中文本，显示浮动工具栏
 */
const handleMouseUp = (event) => {
  const selection = window.getSelection()
  const text = selection.toString().trim()
  if (text.length === 0) {
    showToolbar.value = false
    selectedText.value = ''
    return
  }
  const range = selection.getRangeAt(0)
  const container = articleContainer.value
  if (!container || !container.contains(range.commonAncestorContainer)) {
    showToolbar.value = false
    selectedText.value = ''
    return
  }
  // 检查选区是否在已有标记内
  let node = range.commonAncestorContainer
  while (node && node !== container) {
    if (node.nodeType === 1 && (node.classList?.contains('highlight-yellow') || node.classList?.contains('underline-text'))) {
      showToolbar.value = false
      selectedText.value = ''
      return
    }
    node = node.parentNode
  }
  selectedRange = range.cloneRange()
  selectedText.value = text
  // 定位工具栏
  const rect = range.getBoundingClientRect()
  toolbarX.value = rect.left + rect.width / 2 - 60
  toolbarY.value = rect.top - 50
  if (toolbarY.value < 10) toolbarY.value = rect.bottom + 10
  if (toolbarX.value < 10) toolbarX.value = 10
  if (toolbarX.value + 120 > window.innerWidth) toolbarX.value = window.innerWidth - 130
  showToolbar.value = true
}

const handleMouseDown = () => {}

/**
 * 应用标记（高亮或下划线）
 * @param {string} type - 'highlight' 或 'underline'
 */
const applyMark = (type) => {
  if (!selectedRange) return
  try {
    const range = selectedRange.cloneRange()
    const span = document.createElement('span')
    span.className = type === 'highlight' ? 'highlight-yellow' : 'underline-text'
    span.dataset.marker = 'true'
    range.surroundContents(span)
    const markedText = span.textContent
    const markId = Date.now() + '_' + Math.random().toString(36).substr(2, 5)
    const markData = {
      id: markId,
      text: markedText,
      type: type,
      note: '',
      timestamp: Date.now()
    }
    const newMarks = [...currentMarks.value, markData]
    currentMarks.value = newMarks
    // 采集文本标记事件
    tracker.logEvent('TEXT_HIGHLIGHT', {
      mark_type: type,
      mark_text: markedText,
      mark_id: markId
    }, {
      article_id: currentArticle.value.id
    })
    window.getSelection().removeAllRanges()
    showToolbar.value = false
    selectedRange = null
    selectedText.value = ''
  } catch (e) {
    alert('请选择一段连续的文本，不要跨段落。')
  }
}

const closeToolbar = () => {
  showToolbar.value = false
  window.getSelection().removeAllRanges()
  selectedText.value = ''
}

/**
 * 更新标记的备注 (防抖 2 秒, 避免频繁写库)
 */
let markNoteDebounceTimers = {}
const updateMarkNote = (markId, noteText) => {
  const marks = currentMarks.value.map(m => {
    if (m.id === markId) return { ...m, note: noteText }
    return m
  })
  currentMarks.value = marks
  // 防抖: 2 秒后采集笔记编辑事件
  if (markNoteDebounceTimers[markId]) clearTimeout(markNoteDebounceTimers[markId])
  markNoteDebounceTimers[markId] = setTimeout(() => {
    tracker.logEvent('NOTE_EDIT', {
      mark_id: markId,
      note_content: noteText
    }, {
      article_id: currentArticle.value.id
    })
  }, 2000)
}

/**
 * 删除标记
 */
const removeMark = (markId) => {
  if (confirm('确定删除此标记吗？')) {
    const marks = currentMarks.value.filter(m => m.id !== markId)
    currentMarks.value = marks
    // 采集标记删除事件
    tracker.logEvent('NOTE_EDIT', {
      action: 'delete_mark',
      mark_id: markId
    }, {
      article_id: currentArticle.value.id
    })
  }
}

// ==================== 监听答案修改 (采集 ANSWER_MODIFY 事件) ====================
// 深度监听 currentSelectedOptions，比较新旧值找出被修改的题目并上报
watch(currentSelectedOptions, (newVal, oldVal) => {
  if (!sessionId.value || !oldVal) return
  for (let i = 0; i < newVal.length; i++) {
    if (oldVal[i] !== newVal[i] && newVal[i]) {
      tracker.logEvent('ANSWER_MODIFY', {
        question_index: i,
        old_answer: oldVal[i] || null,
        new_answer: newVal[i]
      }, {
        article_id: currentArticle.value.id,
        question_id: currentQuestions.value[i]?.id || i + 1
      })
    }
  }
}, { deep: true })

// ==================== 监听笔记修改 (采集 NOTE_CREATE / NOTE_EDIT 事件) ====================
// 防抖 2 秒，避免频繁输入时大量上报；首次输入触发 NOTE_CREATE，后续触发 NOTE_EDIT
let noteDebounceTimer = null
watch(currentNoteContent, (newVal, oldVal) => {
  if (!sessionId.value || newVal === oldVal) return
  if (noteDebounceTimer) clearTimeout(noteDebounceTimer)
  noteDebounceTimer = setTimeout(() => {
    tracker.logEvent(
      oldVal === '' ? 'NOTE_CREATE' : 'NOTE_EDIT',
      { note_content: newVal, content_length: newVal.length },
      { article_id: currentArticle.value.id }
    )
  }, 2000)
})

// ==================== 保存和提交 ====================
const saving = ref(false)
const submitting = ref(false)

/**
 * 保存所有答案（阶段1 → 阶段2）。
 *
 * 校验所有题目已作答且会话就绪后：
 *  1. 采集阶段切换事件（1→2）
 *  2. 将当前选中答案快照为 initialAnswers
 *  3. 逐题调用 saveAnswer 上传 initial 答案到后端
 *  4. 采集 PRE_AI_ANSWER_SNAPSHOT 快照
 *  5. 切换到阶段2，解锁 AI 辅助功能
 *
 * @returns {Promise<void>}
 */
const saveAllAnswers = async () => {
  if (!allQuestionsAnswered.value) {
    alert('请回答所有题目')
    return
  }
  if (!sessionId.value) {
    alert('会话未就绪，请刷新页面后重试')
    return
  }
  saving.value = true
  try {
    // 采集阶段切换事件
    tracker.logEvent('STAGE_CHANGE', {
      from_stage: 1,
      to_stage: 2
    }, { article_id: currentArticle.value.id })

    // 保存初始答案
    currentInitialAnswers.value = [...currentSelectedOptions.value]

    // 保存所有答案到后端
    for (let i = 0; i < currentQuestions.value.length; i++) {
      const q = currentQuestions.value[i]
      await saveAnswer({
        session_id: sessionId.value,
        student_code: authStore.user_code,
        article_id: currentArticle.value.id,
        question_id: q.id || i + 1,
        answer: currentSelectedOptions.value[i],
        answer_type: 'initial',
        timestamp: tracker.getTimestamp(),
        correct_answer: q.correctAnswer || null
      })
    }

    // 采集初答保存行为
    tracker.logEvent('PRE_AI_ANSWER_SNAPSHOT', {
      answers: [...currentSelectedOptions.value]
    }, { article_id: currentArticle.value.id })

    currentStage.value = 2
    alert('✅ 所有答案已保存！AI助手已解锁。')
  } catch (error) {
    console.error('保存失败:', error)
    alert('保存失败：' + (error.response?.data?.error || error.message || '未知错误'))
  } finally {
    saving.value = false
  }
}

/**
 * 提交所有答案（阶段2 → 阶段3）。
 *
 * 校验所有题目已作答且会话就绪后：
 *  1. 采集阶段切换事件（2→3）
 *  2. 补全 initialAnswers（缺失则用当前选中值填充）
 *  3. 将当前选中答案快照为 submittedAnswers，标记文章为已完成
 *  4. 逐题调用 saveAnswer 上传 final 答案到后端
 *  5. 立即上报 ANSWER_SUBMIT 事件并 flush 缓冲区
 *  6. 结束当前会话（状态 'completed'）
 *  7. 切换到阶段3，显示正确答案与解析
 *
 * @returns {Promise<void>}
 */
const submitAllAnswers = async () => {
  if (!allQuestionsAnswered.value) {
    alert('请回答所有题目')
    return
  }
  if (!sessionId.value) {
    alert('会话未就绪，请刷新页面后重试')
    return
  }
  submitting.value = true
  try {
    // 采集阶段切换事件
    tracker.logEvent('STAGE_CHANGE', {
      from_stage: 2,
      to_stage: 3
    }, { article_id: currentArticle.value.id })

    currentInitialAnswers.value = currentInitialAnswers.value.map((answer, index) => answer ?? currentSelectedOptions.value[index] ?? null)
    currentSubmittedAnswers.value = [...currentSelectedOptions.value]
    currentProgress.value.completed = true

    // 提交所有答案到后端 (answer_type = 'final')
    for (let i = 0; i < currentQuestions.value.length; i++) {
      const q = currentQuestions.value[i]
      await saveAnswer({
        session_id: sessionId.value,
        student_code: authStore.user_code,
        article_id: currentArticle.value.id,
        question_id: q.id || i + 1,
        answer: currentSelectedOptions.value[i],
        answer_type: 'final',
        timestamp: tracker.getTimestamp(),
        correct_answer: q.correctAnswer || null
      })
    }

    // 采集最终提交事件 (立即上传, 不走缓冲区)
    await tracker.logEventImmediate('ANSWER_SUBMIT', {
      submitted_answers: [...currentSubmittedAnswers.value]
    }, { article_id: currentArticle.value.id })

    // 上传缓冲区中剩余的事件
    await tracker.flush()

    // 标记会话为已完成 (不再由 onUnmounted 处理)
    if (sessionId.value) {
      try {
        await endSession(sessionId.value, 'completed')
      } catch (err) {
        console.error('标记会话完成失败:', err)
      }
    }

    // 切换到阶段三 (触发 watch 采集 STAGE_CHANGE 事件)
    currentStage.value = 3

    alert('🎉 提交成功！查看正确答案和解析。')
  } catch (error) {
    console.error('提交失败:', error)
    alert('提交失败：' + (error.response?.data?.error || error.message || '未知错误'))
  } finally {
    submitting.value = false
  }
}

// ==================== 题目导航 (采集 QUESTION_NAVIGATE 事件) ====================
const prevQuestion = () => {
  if (currentQuestionIndex.value > 0) {
    tracker.logEvent('QUESTION_NAVIGATE', {
      direction: 'prev',
      from_question: currentQuestionIndex.value,
      to_question: currentQuestionIndex.value - 1
    }, { article_id: currentArticle.value.id })
    currentQuestionIndex.value--
  }
}
const nextQuestion = () => {
  if (currentQuestionIndex.value < currentQuestions.value.length - 1) {
    tracker.logEvent('QUESTION_NAVIGATE', {
      direction: 'next',
      from_question: currentQuestionIndex.value,
      to_question: currentQuestionIndex.value + 1
    }, { article_id: currentArticle.value.id })
    currentQuestionIndex.value++
  }
}

// ==================== AI 聊天 ========================
const userInput = ref('')
const aiLoading = ref(false)
const chatMessages = ref(null)
const hintStep = ref(1)
const showMindmapModal = ref(false)
const showVideo = ref(false)
const showAnswerCard = ref(false)

// 思维导图/视频打开时暂停眼动追踪
watch(showMindmapModal, (visible) => {
  if (visible) {
    stopEyeTracking()
  } else {
    startEyeTracking()
  }
})

watch(showVideo, (visible) => {
  if (visible) {
    stopEyeTracking()
  } else {
    startEyeTracking()
  }
})

// 记录 AI 提问的时间戳 (用于计算响应耗时)
let aiRequestTimestamp = null

/**
 * 通用 SSE（Server-Sent Events）流式调用函数。
 *
 * 向后端发起 POST 请求，读取流式响应，按 `data: ` 前缀解析每条 SSE 消息：
 *  - `{ error: ... }` → 调用 onDone(error) 并终止
 *  - `{ done: true }` → 调用 onDone(null) 并终止
 *  - `{ content: "..." }` → 调用 onChunk(content) 追加文本
 *
 * @param {string} endpoint - 后端接口路径
 * @param {object} payload - 请求体
 * @param {function(string): void} onChunk - 每收到一个文本块的回调
 * @param {function(string|null): void} onDone - 流结束时回调（参数为 error 字符串或 null）
 * @returns {Promise<void>}
 */
const callAIStream = async (endpoint, payload, onChunk, onDone) => {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6).trim()
          if (!dataStr) continue
          try {
            const data = JSON.parse(dataStr)
            if (data.error) {
              onDone?.(data.error)
              return
            }
            if (data.done) {
              onDone?.()
              return
            }
            if (data.content) {
              onChunk(data.content)
            }
          } catch (e) {
            console.warn('跳过非JSON数据行:', dataStr)
          }
        }
      }
    }
  } catch (err) {
    console.error('AI 调用失败:', err)
    onDone?.(err.message)
  }
}

/**
 * 处理 AI 功能按钮点击（理解句子 / 分析文段 / 给提示）。
 *
 * 根据按钮类型构造请求参数，调用后端 SSE 流式接口，
 * 实时更新聊天消息中的 AI 占位回复。
 * 流结束后采集 AI_REPLY_RECEIVED 事件并保存完整交互记录到后端。
 *
 * @param {'sentence'|'passage'|'hint'} type - AI 功能类型
 * @returns {Promise<void>}
 */
const handleAI = async (type) => {
  if (currentStage.value < 2) {
    alert('请先完成阶段一（保存答案）')
    return
  }

  // 采集进入 AI 面板事件
  tracker.logEvent('ENTER_AI_PANEL', { ai_module: type })

  const moduleMap = { sentence: 'sentence', passage: 'passage', hint: 'hint' }
  const aiModule = moduleMap[type] || 'free_chat'

  let endpoint = ''
  let payload = {}
  let userMessage = ''
  let aiType = type

  if (type === 'sentence') {
    // 优先使用已有的 selectedText（通过 mouseup 事件采集），
    // 若为空则尝试从 window.getSelection() 兜底获取（防止按钮点击清除选区的情况）
    let textToExplain = selectedText.value
    if (!textToExplain) {
      const liveSelection = window.getSelection()
      const liveText = liveSelection ? liveSelection.toString().trim() : ''
      if (liveText) {
        // 校验选区是否在文章容器内
        const container = articleContainer.value
        if (container && liveSelection.rangeCount > 0) {
          const range = liveSelection.getRangeAt(0)
          if (container.contains(range.commonAncestorContainer)) {
            textToExplain = liveText
            selectedText.value = liveText
            selectedRange = range.cloneRange()
          }
        }
      }
    }
    if (!textToExplain) {
      alert('请先在文章中选中一段文字')
      return
    }
    endpoint = '/api/ai/local'
    payload = {
      selectedText: textToExplain,
      fullText: currentArticle.value.content
    }
    userMessage = `📖 请求解释："${textToExplain}"`
  } else if (type === 'passage') {
    endpoint = '/api/ai/structure'
    payload = { fullText: currentArticle.value.content }
    userMessage = '📄 请求分析全文结构'
  } else if (type === 'hint') {
    if (hintStep.value > 3) {
      alert('所有提示已使用完毕')
      return
    }
    endpoint = '/api/ai/hint'
    payload = {
      fullText: currentArticle.value.content,
      question: currentQuestion.value.question || '',
      userAnswer: currentSelectedOptions.value[currentQuestionIndex.value] || '未选择',
      step: hintStep.value
    }
    userMessage = `💡 请求提示（第 ${hintStep.value}/3 步）`
  } else {
    return
  }

  // 采集 AI 提问前答题快照
  tracker.logEvent('PRE_AI_ANSWER_SNAPSHOT', {
    question_id: currentQuestion.value.id || currentQuestionIndex.value + 1,
    current_answer: currentSelectedOptions.value[currentQuestionIndex.value]
  })

  // 记录提问时间
  aiRequestTimestamp = tracker.getTimestamp()

  // 采集发起 AI 提问事件
  tracker.logEvent('AI_QUESTION_SENT', {
    ai_module: aiModule,
    question_text: userMessage
  }, {
    article_id: currentArticle.value.id,
    question_id: currentQuestion.value.id || currentQuestionIndex.value + 1
  })

  addChatMessage('user', userMessage)

  // 添加 AI 占位消息
  currentChatHistory.value.push({
    role: 'ai',
    content: '...',
    aiType: aiType,
    selectedText: type === 'sentence' ? selectedText.value : null,
    fullText: currentArticle.value.content
  })
  nextTick(() => {
    if (chatMessages.value) chatMessages.value.scrollTop = chatMessages.value.scrollHeight
  })

  aiLoading.value = true
  let fullResponse = ''

  await callAIStream(
    endpoint,
    payload,
    (chunk) => {
      fullResponse += chunk
      const last = currentChatHistory.value.length - 1
      if (currentChatHistory.value[last] && currentChatHistory.value[last].role === 'ai') {
        currentChatHistory.value[last].content = fullResponse
      }
      nextTick(() => {
        if (chatMessages.value) chatMessages.value.scrollTop = chatMessages.value.scrollHeight
      })
    },
    async (error) => {
      aiLoading.value = false
      if (error) {
        const last = currentChatHistory.value.length - 1
        if (currentChatHistory.value[last] && currentChatHistory.value[last].role === 'ai') {
          currentChatHistory.value[last].content = `❌ ${error}`
        }
      } else {
        // 成功完成, 采集 AI 回复事件
        const responseTimestamp = tracker.getTimestamp()
        tracker.logEvent('AI_REPLY_RECEIVED', {
          ai_module: aiModule,
          response_length: fullResponse.length,
          response_preview: fullResponse.substring(0, 100)
        }, {
          article_id: currentArticle.value.id,
          question_id: currentQuestion.value.id || currentQuestionIndex.value + 1
        })

        // 保存完整 AI 交互记录到后端
        await tracker.saveAIInteraction({
          ai_module: aiModule,
          user_question: userMessage,
          ai_response: fullResponse,
          article_excerpt: type === 'sentence' ? payload.selectedText : null,
          article_id: currentArticle.value.id,
          question_id: currentQuestion.value.id || currentQuestionIndex.value + 1,
          model_name: 'deepseek-chat',
          request_timestamp: aiRequestTimestamp,
          response_timestamp: responseTimestamp,
          status: 'success'
        })
      }
      if (type === 'hint' && hintStep.value <= 3) {
        hintStep.value++
      }
      if (type === 'sentence') {
        selectedText.value = ''
      }
    }
  )
}

/**
 * 发送自由提问消息。
 *
 * 调用 /api/ai/chat SSE 流式接口，实时更新聊天消息中的 AI 占位回复。
 * 流结束后采集 AI_REPLY_RECEIVED 事件并保存完整交互记录到后端。
 *
 * @returns {Promise<void>}
 */
const sendMessage = async () => {
  if (!userInput.value.trim() || currentStage.value < 2 || aiLoading.value) return

  const question = userInput.value.trim()
  userInput.value = ''

  // 采集 AI 提问事件
  aiRequestTimestamp = tracker.getTimestamp()
  tracker.logEvent('AI_QUESTION_SENT', {
    ai_module: 'free_chat',
    question_text: question
  }, {
    article_id: currentArticle.value.id,
    question_id: currentQuestion.value.id || currentQuestionIndex.value + 1
  })

  addChatMessage('user', question)

  currentChatHistory.value.push({
    role: 'ai',
    content: '...',
    aiType: 'chat',
    fullText: currentArticle.value.content
  })
  nextTick(() => {
    if (chatMessages.value) chatMessages.value.scrollTop = chatMessages.value.scrollHeight
  })

  aiLoading.value = true
  let fullResponse = ''

  await callAIStream(
    '/api/ai/chat',
    {
      message: question,
      fullText: currentArticle.value.content || '',
      session_id: sessionId.value,
      user_id: authStore.user_id
    },
    (chunk) => {
      fullResponse += chunk
      const last = currentChatHistory.value.length - 1
      if (currentChatHistory.value[last] && currentChatHistory.value[last].role === 'ai') {
        currentChatHistory.value[last].content = fullResponse
      }
      nextTick(() => {
        if (chatMessages.value) chatMessages.value.scrollTop = chatMessages.value.scrollHeight
      })
    },
    async (error) => {
      aiLoading.value = false
      if (error) {
        const last = currentChatHistory.value.length - 1
        if (currentChatHistory.value[last] && currentChatHistory.value[last].role === 'ai') {
          currentChatHistory.value[last].content = `❌ ${error}`
        }
      } else {
        const responseTimestamp = tracker.getTimestamp()
        tracker.logEvent('AI_REPLY_RECEIVED', {
          ai_module: 'free_chat',
          response_length: fullResponse.length,
          response_preview: fullResponse.substring(0, 100)
        })

        await tracker.saveAIInteraction({
          ai_module: 'free_chat',
          user_question: question,
          ai_response: fullResponse,
          article_id: currentArticle.value.id,
          question_id: currentQuestion.value.id || currentQuestionIndex.value + 1,
          model_name: 'deepseek-chat',
          request_timestamp: aiRequestTimestamp,
          response_timestamp: responseTimestamp,
          status: 'success'
        })
      }
    }
  )
}

const addChatMessage = (role, content) => {
  currentChatHistory.value.push({ role, content })
  nextTick(() => {
    if (chatMessages.value) {
      chatMessages.value.scrollTop = chatMessages.value.scrollHeight
    }
  })
}

// ==================== AI 回复操作函数 ========================

/**
 * 将 AI 回复内容加入笔记
 */
const addToNote = (content) => {
  if (!content || content === '...' || content.startsWith('❌')) return
  const separator = currentNoteContent.value ? '\n\n' : ''
  currentNoteContent.value = currentNoteContent.value + separator + '【AI建议】' + content
  // 采集笔记编辑事件
  tracker.logEvent('NOTE_EDIT', {
    action: 'ai_add_to_note',
    content: content
  }, {
    article_id: currentArticle.value.id
  })
  const btn = document.activeElement
  if (btn) {
    const orig = btn.textContent
    btn.textContent = '✅ 已加入'
    setTimeout(() => { btn.textContent = orig }, 1500)
  }
}

/**
 * 滚动到 AI 理解句子功能选中的原文位置
 */
const scrollToSelectedText = (msg) => {
  if (!msg.selectedText) return
  const container = articleContainer.value
  if (!container) return
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false)
  let node
  let targetNode = null
  while ((node = walker.nextNode())) {
    if (node.textContent.includes(msg.selectedText)) {
      targetNode = node.parentNode
      break
    }
  }
  if (targetNode) {
    targetNode.scrollIntoView({ behavior: 'smooth', block: 'center' })
    targetNode.style.backgroundColor = '#fef3c7'
    setTimeout(() => {
      targetNode.style.backgroundColor = ''
    }, 2000)
    tracker.logEvent('QUESTION_NAVIGATE', {
      action: 'return_to_original',
      selectedText: msg.selectedText
    })
  } else {
    alert('未找到原文对应位置')
  }
}

// ==================== 计时器 ====================
// 每篇文章独立计时：startTime 为当前文章计时起点，elapsedSeconds 为已用秒数
// 页面切到后台时通过 pausedAccumulated / hiddenStartTime 扣除暂停时间
const startTime = ref(Date.now())
const accumulatedDuration = ref(0)  // 从后端获取的累计有效学习时长（秒）
const elapsedSeconds = ref(0)
let timerInterval = null              // 每秒更新 elapsedSeconds 的定时器
let heartbeatInterval = null          // 每 30 秒上报心跳的定时器
let pausedAccumulated = 0             // 页面切到后台时累积的暂停秒数
let hiddenStartTime = null            // 页面切到后台的时刻

const taskTimer = computed(() => {
  const total = elapsedSeconds.value
  const mins = Math.floor(total / 60)
  const secs = total % 60
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
})

const stages = [
  { num: 1, label: '独立初读' },
  { num: 2, label: 'AI辅助' },
  { num: 3, label: '答案与解析' }
]

const goToProfile = () => {
  router.push('/profile')
}

// ==================== 监听阶段切换 (采集 STAGE_CHANGE 事件) ====================
// saveAllAnswers / submitAllAnswers 中设置 currentStage.value 会触发此 watcher
watch(currentStage, async (newVal, oldVal) => {
  if (newVal !== oldVal) {
    tracker.logEvent('STAGE_CHANGE', {
      from_stage: oldVal,
      to_stage: newVal
    }, { article_id: currentArticle.value.id })
  }
})

// ==================== 页面卸载时上传剩余数据 ====================
/**
 * 页面卸载前（关闭/刷新）的收尾处理。
 * 使用 sendBeacon 异步结束会话，同步 flush tracker 缓冲区和眼动数据。
 */
const handleBeforeUnload = () => {
  // 使用 sendBeacon 保证请求在页面关闭时也能发出
  if (sessionId.value) {
    sendBeaconEndSession(sessionId.value, 'abandoned')
  }
  // tracker 的 flush 用同步方式尽力发送
  tracker.flush()
  tracker.flushEyeTrackingData()
}

// ==================== 页面可见性变化 (切到后台暂停计时和眼动) ====================
/**
 * 处理页面可见性变化（visibilitychange 事件）。
 *
 * 页面隐藏时：
 *  - 暂停眼动追踪（不记录后台数据）
 *  - 记录隐藏时刻，立即发送一次心跳
 *
 * 页面恢复时：
 *  - 计算暂停时长，超过 5 秒则从计时器中扣除（忽略短暂闪烁）
 *  - 刷新 AOI 坐标并重启眼动追踪
 *  - 发送心跳恢复活跃状态
 */
const handleVisibilityChange = () => {
  if (document.hidden) {
    // 页面切到后台 / 失去焦点, 暂停眼动追踪 (不记录后台数据)
    stopEyeTracking()

    // 记录暂停时刻
    hiddenStartTime = Date.now()
    // 立即发一次心跳, 确保后端记录最后活跃时间
    if (sessionId.value) {
      heartbeatSession(sessionId.value).catch(() => {})
    }
  } else {
    // 页面恢复前台, 恢复眼动追踪
    if (hiddenStartTime) {
      const pausedSecs = Math.floor((Date.now() - hiddenStartTime) / 1000)
      // 暂停超过 5 秒才算 (忽略短暂闪烁)
      if (pausedSecs > 5) {
        pausedAccumulated += pausedSecs
        // 调整 startTime, 使 elapsedSeconds 不包含暂停时间
        startTime.value += pausedSecs * 1000
      }
      hiddenStartTime = null
    }
    // 恢复眼动追踪 (刷新 AOI 区域, 重新注册)
    refreshAoiAndRestart()
    // 恢复心跳
    if (sessionId.value) {
      heartbeatSession(sessionId.value).catch(() => {})
    }
  }
}

// ==================== 眼动追踪: 注册 AOI + 启动 ========================
/**
 * 注册 AOI（兴趣区域）区域到 eyeTracker。
 * 在 nextTick 中执行，确保 DOM 已渲染完成。
 * 注册四个区域：阅读区、题目区、AI 聊天区、笔记区。
 */
function registerAoiZones() {
  // 等待 DOM 渲染完成后注册
  nextTick(() => {
    if (aoiReadingRef.value) {
      eyeTracker.registerAoi(AOI_TYPES.READING, aoiReadingRef.value)
    }
    if (aoiQuestionRef.value) {
      eyeTracker.registerAoi(AOI_TYPES.QUESTION, aoiQuestionRef.value)
    }
    if (aoiAiChatRef.value) {
      eyeTracker.registerAoi(AOI_TYPES.AI_CHAT, aoiAiChatRef.value)
    }
    if (aoiNoteRef.value) {
      eyeTracker.registerAoi(AOI_TYPES.NOTE, aoiNoteRef.value)
    }
  })
}

/**
 * 启动眼动追踪。
 * 数据回调将注视点推给 tracker 上传；状态回调更新顶部徽章。
 */
function startEyeTracking() {
  eyeTracker.startTracking(
    // 数据回调: 推给 tracker 上传
    (dataPoint) => {
      tracker.pushEyeTrackingData(dataPoint)
    },
    // 状态回调: 更新徽章
    (status) => {
      eyeStatus.value = status.status
    }
  )
}

/**
 * 停止眼动追踪，将状态重置为 idle。
 */
function stopEyeTracking() {
  eyeTracker.stopTracking()
  eyeStatus.value = 'idle'
}

// 刷新 AOI 坐标并重启眼动追踪（页面从后台恢复时调用，坐标可能已变化）
function refreshAoiAndRestart() {
  eyeTracker.refreshAoiRects()
  startEyeTracking()
}

// 窗口缩放时刷新 AOI 区域位置（布局变化后坐标需要重新计算）
function handleResize() {
  eyeTracker.refreshAoiRects()
}

// ==================== 会话管理 (切换文章时创建新会话) ========================
/**
 * 为当前文章创建或复用后端会话。
 *
 * 流程：
 *  1. 若当前文章已完成（sessionLocked），直接返回
 *  2. 结束旧会话（状态 'abandoned'），清空 sessionId
 *  3. 调用 createSession 创建新会话，获取 session_id 和 time_anchor
 *  4. 初始化 tracker，重置计时器起点
 *  5. 上报 SESSION_START 事件
 *  6. 若后端返回 409（文章已完成），尝试复用返回的 existing_session_id
 *
 * @returns {Promise<void>}
 */
async function ensureSessionForCurrentArticle() {
  // 如果当前文章已完成，不需要创建会话
  if (sessionLocked.value) return

  // 结束旧会话（切换文章时，旧会话标记为 abandoned）
  if (sessionId.value) {
    try {
      await endSession(sessionId.value, 'abandoned')
    } catch (err) {
      console.error('结束旧会话失败:', err)
    }
    sessionId.value = null
  }

  try {
    const result = await createSession({
      student_code: authStore.user_code,
      article_id: currentArticle.value.id || 1,
    })

    if (result.success) {
      sessionId.value = result.data.session_id

      // 用 session_id 和 time_anchor 初始化 tracker（后续事件都用此 session_id）
      tracker.init(sessionId.value, authStore.user_code, result.data.time_anchor)

      if (result.data.accumulated_duration) {
        accumulatedDuration.value = result.data.accumulated_duration
        console.log('[Timer] 累计有效学习时长:', accumulatedDuration.value, '秒')
      }

      // 重置当前文章的计时器起点（每篇文章独立计时）
      startTime.value = Date.now()
      elapsedSeconds.value = 0
      pausedAccumulated = 0
      hiddenStartTime = null

      // 后端复用了进行中的会话（学生之前未完成就离开）
      if (result.data.is_reused) {
        console.log('[Session] 复用现有进行中会话:', sessionId.value)
      }

      await tracker.logEventImmediate('SESSION_START', {
        article_id: currentArticle.value.id,
        student_code: authStore.user_code,
        is_reused: result.data.is_reused || false
      })
    }
  } catch (err) {
    if (err.response?.status === 409) {
      // 409: 该文章已有已完成会话，尝试复用返回的 existing_session_id
      const existingId = err.response?.data?.data?.existing_session_id
      if (existingId) {
        sessionId.value = existingId
        tracker.init(sessionId.value, authStore.user_code, Date.now())
        console.log('[Session] 文章已完成, 使用历史会话:', sessionId.value)
      } else {
        console.log('[Session] 该文章已完成, 禁止重复答题')
      }
    } else {
      console.error('创建会话失败:', err)
    }
  }
}

// ==================== 生命周期 ========================
/**
 * 页面挂载时的初始化流程：
 *  1. 校验登录状态
 *  2. 从服务器加载题库
 *  3. 处理从 ProfilePage 跳转时的 article 参数
 *  4. 从后端恢复答题进度
 *  5. 创建/复用当前文章的阅读会话
 *  6. 启动计时器（每秒）和心跳定时器（每 30 秒）
 *  7. 注册 beforeunload / visibilitychange / resize 事件
 *  8. 注册 AOI 区域并启动眼动追踪
 *  9. 添加 AI 欢迎消息（若对话记录为空）
 */
onMounted(async () => {
  if (!authStore.user_code) {
    router.push('/login')
    return
  }

  // 从服务器加载题库
  await loadArticlesFromServer()

  // 从 ProfilePage 点击笔记跳转来时, 切换到对应文章
  const articleQuery = route.query.article
  if (articleQuery) {
    const targetId = parseInt(articleQuery)
    const idx = articles.value.findIndex(a => a.id === targetId)
    if (idx >= 0) {
      currentArticleIndex.value = idx
    }
  }

  // 从后端恢复答题进度 (刷新后不丢失)
  await restoreProgressFromBackend()

  // 创建或复用当前文章的阅读会话
  await ensureSessionForCurrentArticle()

  // 启动计时器（每秒更新 elapsedSeconds，基于 startTime 计算）
  timerInterval = setInterval(() => {
    elapsedSeconds.value = Math.floor((Date.now() - startTime.value) / 1000)
  }, 1000)

  // 启动心跳定时器（每 30 秒上报，确保页面异常关闭时后端有最近的心跳时间）
  heartbeatInterval = setInterval(() => {
    if (sessionId.value) {
      heartbeatSession(sessionId.value).catch(() => {})
    }
  }, 30000)

  // 监听页面卸载事件 (上传剩余数据)
  window.addEventListener('beforeunload', handleBeforeUnload)

  // 监听页面可见性变化 (切到后台暂停计时)
  document.addEventListener('visibilitychange', handleVisibilityChange)

  // ==================== 启动眼动追踪 ====================
  // 注册 AOI 区域并启动追踪 (眼动数据通过 tracker 推送到后端)
  registerAoiZones()
  startEyeTracking()

  // 监听窗口缩放, 刷新 AOI 区域位置
  window.addEventListener('resize', handleResize)

  // 如果当前文章没有恢复出对话记录, 添加欢迎消息
  if (currentChatHistory.value.length === 0) {
    addChatMessage('ai', '你好！我是AI阅读助手。你可以点击上方按钮获取帮助，或在下方提问。')
  }
})

/**
 * 页面卸载时的清理流程：
 *  - 清除计时器和心跳定时器
 *  - 移除所有事件监听
 *  - 停止眼动追踪
 *  - flush 并销毁 tracker
 *  - 结束当前会话（状态 'abandoned'）
 */
onUnmounted(async () => {
  if (timerInterval) clearInterval(timerInterval)
  if (heartbeatInterval) clearInterval(heartbeatInterval)
  window.removeEventListener('beforeunload', handleBeforeUnload)
  window.removeEventListener('resize', handleResize)
  document.removeEventListener('visibilitychange', handleVisibilityChange)

  // 停止眼动追踪
  stopEyeTracking()

  // 上传所有剩余数据并销毁 tracker
  await tracker.destroy()

  // 结束会话 (路由跳转离开, 不是页面关闭)
  if (sessionId.value) {
    try {
      await endSession(sessionId.value, 'abandoned')
    } catch (err) {
      console.error('结束会话失败:', err)
    }
  }
})
</script>

<style scoped>
/* ===== 原有样式（保留） ===== */
.reading-page {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  background-color: #f9fafb;
  overflow: hidden;
  margin: 0;
  padding: 0;
  width: 100vw;
  height: 100vh;
}
.top-nav {
  flex-shrink: 0;
  background: white;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
  border-bottom: 1px solid #e5e7eb;
  padding: 0 16px;
  height: 56px;
  margin: 0;
}
.nav-content {
  display: flex;
  align-items: center;
  gap: 32px;
  height: 100%;
}
.brand {
  font-size: 1.25rem;
  font-weight: bold;
  color: #2563eb;
  white-space: nowrap;
}
.stage-group {
  display: flex;
  gap: 24px;
  flex-wrap: nowrap;
}
.stage-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 0.875rem;
  transition: all 0.3s;
  white-space: nowrap;
}
.stage-number {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-weight: bold;
  font-size: 0.75rem;
  background: #e5e7eb;
  color: #9ca3af;
}
.stage-indicator.active .stage-number {
  background: #3b82f6;
  color: white;
}
.stage-indicator.completed .stage-number {
  background: #22c55e;
  color: white;
}
.stage-indicator.locked .stage-number {
  background: #e5e7eb;
  color: #9ca3af;
}
.stage-label {
  color: #6b7280;
  font-weight: 500;
}
.stage-indicator.active .stage-label {
  color: #1f2937;
  font-weight: 600;
}
.stage-indicator.completed .stage-label {
  color: #22c55e;
}
.stage-indicator.locked .stage-label {
  color: #9ca3af;
}
.timer {
  font-size: 0.875rem;
  color: #6b7280;
  white-space: nowrap;
}
.eye-status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 0.78rem;
  font-weight: 600;
  white-space: nowrap;
  transition: all 0.2s;
}
.eye-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.eye-active {
  background: #dcfce7;
  color: #16a34a;
}
.eye-active .eye-dot {
  background: #22c55e;
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
  animation: eye-pulse 2s infinite;
}
.eye-degraded {
  background: #fef3c7;
  color: #d97706;
}
.eye-degraded .eye-dot {
  background: #f59e0b;
}
.eye-idle {
  background: #f3f4f6;
  color: #9ca3af;
}
.eye-idle .eye-dot {
  background: #d1d5db;
}
@keyframes eye-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
.import-btn {
  background: #8b5cf6;
  color: white;
  border: none;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  margin-left: 12px;
}
.import-btn:hover {
  background: #7c3aed;
}
.profile-btn {
  background: #3b82f6;
  color: white;
  border: none;
  padding: 4px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  margin-left: 4px;
}
.profile-btn:hover {
  background: #2563eb;
}
.timer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.main-content {
  flex: 1;
  display: flex;
  overflow: hidden;
  margin: 0;
  padding: 0;
}

.left-panel {
  flex: 0 0 70%;
  display: flex;
  flex-direction: column;
  padding: 12px 8px 12px 16px;
  background: #f9fafb;
  overflow: hidden;
}

/* 答题卡 */
.answer-card-trigger {
  position: relative;
  margin-bottom: 8px;
  flex-shrink: 0;
}
.answer-card-btn {
  padding: 6px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
  font-size: 0.95rem;
}
.answer-card-btn:hover {
  background: #2563eb;
}
.answer-card-popup {
  position: absolute;
  top: 40px;
  left: 0;
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  padding: 16px;
  z-index: 100;
  min-width: 200px;
  border: 1px solid #e5e7eb;
}
.answer-card-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}
.answer-card-item {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 0;
  border-radius: 6px;
  font-weight: 600;
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid transparent;
}
.answer-card-item.completed {
  background: #22c55e;
  color: white;
  border-color: #16a34a;
}
.answer-card-item.active {
  background: #3b82f6;
  color: white;
  border-color: #2563eb;
}
.answer-card-item.unattempted {
  background: #e5e7eb;
  color: #6b7280;
  border-color: #d1d5db;
}
.answer-card-item:hover {
  transform: scale(1.05);
}
.answer-card-legend {
  display: flex;
  gap: 16px;
  justify-content: center;
  font-size: 0.8rem;
  color: #4b5563;
  border-top: 1px solid #e5e7eb;
  padding-top: 10px;
}
.answer-card-legend .dot {
  display: inline-block;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  margin-right: 4px;
  vertical-align: middle;
}
.answer-card-legend .dot.green {
  background: #22c55e;
}
.answer-card-legend .dot.blue {
  background: #3b82f6;
}
.answer-card-legend .dot.gray {
  background: #d1d5db;
}

/* 文章 */
.article-wrapper {
  flex: 0 0 55%;
  padding: 0 0 8px 0;
  overflow: hidden;
}
.article-container {
  height: 100%;
  overflow-y: auto;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  padding: 16px;
  text-align: left;
  user-select: text;
}
.article-container::-webkit-scrollbar {
  width: 6px;
}
.article-container::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 4px;
}
.article-container :deep(.highlight-yellow) {
  background-color: #FFEB3B;
  padding: 0 2px;
  border-radius: 2px;
}
.article-container :deep(.underline-text) {
  text-decoration: underline;
  text-decoration-color: #3b82f6;
  text-underline-offset: 2px;
}

/* 题目 */
.question-wrapper {
  flex: 1;
  padding: 8px 0 0 0;
  overflow: hidden;
}
.question-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  padding: 16px;
  overflow-y: auto;
}
.question-container > * {
  flex-shrink: 0;
}
.question-container .button-group {
  margin-top: auto;
  padding-top: 12px;
}

.options-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 12px;
}
.option-item {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.2s;
}
.option-item.selected {
  background: #eff6ff;
  border-color: #3b82f6;
}
/* 正确答案：绿色 */
.option-item.correct {
  background-color: #d1fae5 !important;
  border-color: #10b981 !important;
  color: #065f46;
}
/* 你选错的选项：红色 */
.option-item.wrong {
  background-color: #fee2e2 !important;
  border-color: #ef4444 !important;
  color: #991b1b;
}
.question-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.q-title {
  margin: 0;
  text-align: left;
}
.nav-buttons {
  display: flex;
  gap: 8px;
}
.nav-buttons button {
  padding: 4px 12px;
  background: #e5e7eb;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.nav-buttons button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.q-text {
  text-align: left;
  margin-bottom: 12px;
}

/* 解析框 */
.explanation-box {
  margin: 8px 0 12px;
  padding: 10px 14px;
  background: #fefce8;
  border-left: 4px solid #eab308;
  border-radius: 6px;
  text-align: left;
}
.explanation-title {
  font-weight: 600;
  font-size: 14px;
  color: #854d0e;
  margin-bottom: 4px;
}
.explanation-text {
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
  color: #44403c;
}

.button-group {
  display: flex;
  gap: 12px;
}
.btn-primary,
.btn-success,
.btn-secondary {
  flex: 1;
  padding: 8px 12px;
  border: none;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
  color: white;
  font-size: 0.9rem;
}
.btn-primary {
  background: #3b82f6;
}
.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-success {
  background: #22c55e;
}
.btn-success:hover:not(:disabled) {
  background: #16a34a;
}
.btn-success:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.btn-secondary {
  background: #8b5cf6;
}
.btn-secondary:hover {
  background: #7c3aed;
}
.stage-hint {
  margin-top: 8px;
  padding: 6px 10px;
  background: #f9fafb;
  border-radius: 4px;
  font-size: 0.8rem;
  color: #6b7280;
}
.stage-hint p {
  margin: 0;
}

/* ===== 右侧面板 ===== */
.right-panel {
  flex: 0 0 30%;
  display: flex;
  padding: 12px 12px;
  background: #f9fafb;
  overflow: hidden;
  margin: 0;
}

.ai-container {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  padding: 12px;
  overflow: hidden;
}

/* AI 按钮（固定） */
.ai-buttons {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  flex-shrink: 0;
}
.ai-btn {
  flex: 1;
  padding: 6px 0;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  font-weight: 500;
}
.ai-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 可滚动内容区（占用剩余高度） */
.scrollable-area {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
  gap: 8px;
}

/* 对话区域 */
.chat-area {
  display: flex;
  flex-direction: column;
  flex: 1 1 40%;
  min-height: 120px;
  min-width: 0;
}
.chat-messages {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  background: #f9fafb;
  border-radius: 6px;
  padding: 6px;
  margin-bottom: 6px;
}
.chat-msg {
  margin-bottom: 4px;
  padding: 4px 8px;
  border-radius: 4px;
}
.chat-msg.user {
  background: #dbeafe;
  text-align: right;
}
.chat-msg.ai {
  background: #e5e7eb;
  text-align: left;
}
.chat-input-area {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}
.chat-input-area input {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
}
.chat-input-area input:disabled {
  background: #f3f4f6;
}
.chat-input-area button {
  padding: 6px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.chat-input-area button:disabled {
  background: #9ca3af;
}
.stage-lock-hint {
  width: 100%;
  padding: 6px 10px;
  background: #fef3c7;
  border: 1px solid #f59e0b;
  border-radius: 6px;
  color: #92400e;
  font-size: 0.85rem;
  text-align: center;
}

/* 资源区域 */
.resource-area {
  flex: 0 0 auto;
  max-height: 180px;
  overflow-y: auto;
}
.resource-item {
  margin-bottom: 4px;
}
.resource-toggle {
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  padding: 3px 10px;
  cursor: pointer;
  font-size: 0.85rem;
  width: 100%;
  text-align: left;
}
.resource-toggle:hover {
  background: #e5e7eb;
}
.resource-content {
  margin-top: 4px;
  padding: 6px;
  background: #f9fafb;
  border-radius: 6px;
}
.video-player {
  width: 100%;
  max-height: 120px;
  border-radius: 4px;
}

/* 笔记区域 */
.note-area {
  flex: 1 1 40%;
  min-height: 90px;
  overflow-y: auto;
}
.note-header {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  color: #374151;
  margin-bottom: 2px;
}
.note-count {
  color: #6b7280;
  font-size: 0.75rem;
}
.note-area textarea {
  width: 100%;
  padding: 4px 8px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  resize: vertical;
  font-family: inherit;
  font-size: 0.85rem;
  height: 70px;
  min-height: 50px;
}

/* 标记列表 */
.marks-list {
  margin-top: 4px;
  border-top: 1px solid #e5e7eb;
  padding-top: 4px;
  max-height: 150px;
  overflow-y: auto;
}
.marks-header {
  font-size: 0.85rem;
  font-weight: 600;
  color: #374151;
  margin-bottom: 4px;
}
.mark-item {
  background: #f9fafb;
  border-radius: 4px;
  padding: 4px 6px;
  margin-bottom: 4px;
}
.mark-text {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 2px;
}
.mark-highlight {
  background-color: #FFEB3B;
  padding: 0 2px;
}
.mark-underline {
  text-decoration: underline;
  text-decoration-color: #3b82f6;
}
.mark-type {
  font-size: 0.75rem;
}
.mark-delete {
  background: none;
  border: none;
  color: #ef4444;
  cursor: pointer;
  font-size: 0.75rem;
  margin-left: auto;
}
.mark-note-input {
  width: 100%;
  padding: 2px 6px;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  font-size: 0.8rem;
  box-sizing: border-box;
}

/* 浮动工具栏 */
.floating-toolbar {
  position: fixed;
  background: white;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  padding: 4px;
  display: flex;
  gap: 4px;
  z-index: 1000;
  white-space: nowrap;
}
.toolbar-btn {
  padding: 4px 10px;
  border: none;
  background: transparent;
  border-radius: 4px;
  cursor: pointer;
  font-size: 0.85rem;
  transition: background 0.2s;
}
.toolbar-btn:hover {
  background: #f3f4f6;
}
.close-btn {
  color: #6b7280;
}

/* 响应式 */
@media (max-width: 768px) {
  .main-content {
    flex-direction: column;
  }
  .left-panel {
    flex: 1;
    padding: 8px;
  }
  .right-panel {
    flex: 0 0 45%;
    padding: 8px;
  }
  .article-wrapper {
    flex: 0 0 50%;
  }
  .options-grid {
    grid-template-columns: 1fr;
  }
}

/* AI 消息操作按钮 */
.chat-msg-wrapper {
  margin-bottom: 8px;
}
.chat-msg {
  margin-bottom: 2px;
  padding: 4px 8px;
  border-radius: 4px;
}
.chat-msg.user {
  background: #dbeafe;
  text-align: right;
}
.chat-msg.ai {
  background: #e5e7eb;
  text-align: left;
}
.msg-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
  padding-left: 8px;
}
.action-btn {
  background: none;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 0.75rem;
  cursor: pointer;
  color: #374151;
  transition: background 0.2s;
}
.action-btn:hover {
  background: #f3f4f6;
}

/* 模态框 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}
.modal-content {
  background: white;
  border-radius: 12px;
  padding: 24px;
  max-width: 80%;
  max-height: 80%;
  overflow: auto;
  position: relative;
}
.modal-close {
  position: absolute;
  top: 8px;
  right: 12px;
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
}
.mindmap-modal-image {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
}
</style>
