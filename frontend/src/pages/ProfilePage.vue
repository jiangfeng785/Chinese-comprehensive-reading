<template>
  <div class="profile-page">
    <!-- 顶部导航 -->
    <header class="top-nav">
      <button @click="goBack" class="back-btn">&larr; 返回阅读</button>
      <span class="brand">个人学习记录</span>
      <span class="user-code">{{ userCode }}</span>
    </header>

    <main class="main-content">
      <div v-if="loading" class="loading">加载中...</div>
      <div v-else class="content-wrapper">
        <!-- ========== 顶部统计卡片 ========== -->
        <div class="stats-grid">
          <div class="stat-card stat-duration">
            <div class="stat-icon">&#9201;</div>
            <div class="stat-value">{{ formatDuration(stats.totalDuration) }}</div>
            <div class="stat-label">累计有效学习时长</div>
          </div>
          <div class="stat-card stat-questions">
            <div class="stat-icon">&#128203;</div>
            <div class="stat-value">{{ stats.completedQuestions }}</div>
            <div class="stat-label">已完成题目数量</div>
          </div>
          <div class="stat-card stat-accuracy">
            <div class="stat-icon">&#127919;</div>
            <div class="stat-value">{{ stats.initialAccuracy }}%</div>
            <div class="stat-label">独立初读正确率</div>
            <div class="stat-sub" v-if="stats.totalAnswered > 0">
              修正后 {{ stats.finalAccuracy }}% | 修正 {{ stats.fixedByAI }} 题
            </div>
          </div>
          <div class="stat-card stat-score">
            <div class="stat-icon">&#127942;</div>
            <div class="stat-value">{{ stats.score }}</div>
            <div class="stat-label">累计积分</div>
            <div class="stat-sub">
              排名 {{ stats.rank }} / {{ stats.totalStudents }}
            </div>
          </div>
        </div>

        <!-- ========== 中部双栏 ========== -->
        <div class="dual-panel">
          <!-- 左侧：学习记录 (笔记 + AI对话) -->
          <div class="records-panel">
            <div class="panel-header">
              <h3 class="panel-title">&#128221; 学习记录</h3>
              <span class="note-total">{{ filteredRecords.length }} 条</span>
            </div>

            <!-- 筛选栏 -->
            <div class="filter-bar">
              <input
                v-model="searchKeyword"
                type="text"
                placeholder="搜索关键词..."
                class="filter-input"
              />
              <select v-model="filterDate" class="filter-select">
                <option value="">所有日期</option>
                <option v-for="d in availableDates" :key="d" :value="d">{{ d }}</option>
              </select>
            </div>

            <!-- 记录列表 -->
            <div class="records-list">
              <div v-if="filteredRecords.length === 0" class="empty-state">
                暂无学习记录
              </div>
              <div
                v-for="record in filteredRecords"
                :key="record.article_id"
                class="record-card"
              >
                <!-- 卡片头部 -->
                <div class="record-card-header" @click="toggleExpand(record.article_id)">
                  <span class="record-article">文章 #{{ record.article_id }}</span>
                  <span v-if="record.submitted_at" class="record-date">提交时间: {{ formatDate(record.submitted_at) }}</span>
                  <span class="expand-toggle">{{ expandedArticle === record.article_id ? '收起' : '展开' }}</span>
                </div>

                <!-- 文章内容片段 -->
                <div v-if="getArticleSnippet(record.article_id)" class="record-section">
                  <div class="article-snippet">{{ getArticleSnippet(record.article_id) }}</div>
                </div>

                <!-- 跳转按钮 -->
                <div class="record-card-footer">
                  <button class="jump-btn" @click="openArticle(record.article_id)">&#8594; 跳转原文</button>
                </div>
              </div>
            </div>
          </div>

          <!-- 右侧：排行榜 -->
          <div class="leaderboard-panel">
            <div class="panel-header">
              <h3 class="panel-title">&#127942; 排行榜</h3>
            </div>
            <div class="leaderboard-list">
              <div v-if="leaderboard.length === 0" class="empty-state">
                暂无排行数据
              </div>
              <div
                v-for="(item, idx) in leaderboard"
                :key="item.student_code"
                class="rank-item"
                :class="{
                  'rank-me': item.is_me,
                  'rank-1': idx === 0,
                  'rank-2': idx === 1,
                  'rank-3': idx === 2
                }"
              >
                <span class="rank-num">{{ idx + 1 }}</span>
                <span class="rank-code">{{ item.student_code }}</span>
                <span class="rank-score">{{ item.score }} 分</span>
                <span class="rank-questions">{{ item.completed_questions }} 题</span>
              </div>
            </div>
          </div>
        </div>

        <!-- ========== 管理员导出 (仅 test 可见) ========== -->
        <div v-if="isAdmin" class="admin-section">
          <h3 class="admin-title">&#128274; 管理员数据导出</h3>
          <div class="admin-actions">
            <button @click="exportAll" class="admin-btn">
              &#128229; 导出全部参与者实验数据 (CSV)
            </button>
            <button @click="exportMine" class="admin-btn admin-btn-secondary">
              &#128229; 导出我的实验数据 (CSV)
            </button>
          </div>
          <p class="admin-hint">
            数据按 学生编号 -> 文章ID -> 题目ID 分层排序, 包含会话/答题/行为日志/AI交互/眼动追踪全量数据。
          </p>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
/**
 * ProfilePage - 学生个人学习记录页
 *
 * 职责：
 * 1. 展示当前学生的核心学习统计（累计时长、完成题目数、初读/修正后正确率、积分与排名）。
 * 2. 渲染学习记录列表（按文章聚合），支持关键词搜索与日期筛选，可展开查看文章片段并跳转原文。
 * 3. 展示全班排行榜，高亮当前用户及前三名。
 * 4. 管理员（user_code === 'test'）可导出全量或个人实验数据为 CSV。
 *
 * 数据来源：getProfile 接口（统计 + 记录 + 排行榜）+ /api/articles（文章内容，用于片段预览）。
 */
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/useAuthStore'
import { getProfile, exportAllDataCSV, exportStudentCSV } from '../utils/api'

const router = useRouter()
const authStore = useAuthStore()

// ===== 响应式状态 =====
const loading = ref(true)
/** 顶部统计卡片数据，字段与后端 getProfile.stats 一一对应 */
const stats = ref({
  totalDuration: 0,       // 累计有效学习时长（秒）
  completedQuestions: 0,  // 已完成题目数量
  initialAccuracy: 0,     // 独立初读正确率（%）
  finalAccuracy: 0,       // AI 修正后正确率（%）
  fixedByAI: 0,           // 被 AI 修正的题目数
  totalAnswered: 0,       // 总答题数（用于判断是否显示修正后信息）
  score: 0,               // 累计积分
  rank: 0,                // 当前用户排名
  totalStudents: 0,       // 参与排行的总学生数
})
const records = ref([])        // 学习记录列表（按文章聚合，含笔记/AI对话/时间戳）
const leaderboard = ref([])    // 全班排行榜（按积分降序）
const articlesMap = ref({})    // article_id -> { title, content }，用于文章片段预览

// ===== 筛选与交互状态 =====
const searchKeyword = ref('')       // 关键词搜索框绑定值
const filterDate = ref('')          // 日期筛选值，'' 表示所有日期
const expandedArticle = ref(null)   // 当前展开的文章 ID（同时只展开一张卡片）

/** 当前登录用户编号（未登录时显示占位文本） */
const userCode = computed(() => authStore.user_code || '未登录')
/** 是否为管理员（仅 test 账号可见导出区域） */
const isAdmin = computed(() => authStore.user_code === 'test')

/**
 * 从学习记录中提取所有可用日期（去重 + 降序），供日期筛选下拉框使用。
 * 优先取 note_updated_at，回退到 latest_timestamp。
 * @returns {string[]} 形如 ['2025-08-16', '2025-08-15'] 的日期字符串数组
 */
const availableDates = computed(() => {
  const dates = new Set()
  for (const r of records.value) {
    const ts = r.note_updated_at || r.latest_timestamp
    if (ts) {
      const d = new Date(ts)
      if (!isNaN(d.getTime())) {
        // toISOString 返回 UTC，slice(0,10) 截取 YYYY-MM-DD
        dates.add(d.toISOString().slice(0, 10))
      }
    }
  }
  return Array.from(dates).sort((a, b) => b.localeCompare(a))
})

/**
 * 根据关键词和日期对学习记录进行筛选。
 * 关键词匹配范围：笔记内容、文章 ID、AI 对话（用户提问 + AI 回复）。
 * 日期匹配：取记录的 note_updated_at 或 latest_timestamp，比较其 YYYY-MM-DD 部分。
 * @returns {Array} 筛选后的记录数组
 */
const filteredRecords = computed(() => {
  let result = records.value

  // 按关键词筛选（搜索笔记内容、文章ID、AI对话）
  if (searchKeyword.value.trim()) {
    const kw = searchKeyword.value.trim().toLowerCase()
    result = result.filter(r => {
      // 搜索笔记内容
      if (r.note_content && r.note_content.toLowerCase().includes(kw)) return true
      // 搜索文章ID
      if (String(r.article_id).includes(kw)) return true
      // 搜索AI对话（匹配用户提问或AI回复）
      if (r.ai_chats && r.ai_chats.some(c =>
        (c.user_question && c.user_question.toLowerCase().includes(kw)) ||
        (c.ai_response && c.ai_response.toLowerCase().includes(kw))
      )) return true
      return false
    })
  }

  // 按日期筛选（比较 YYYY-MM-DD）
  if (filterDate.value) {
    const filterDateStr = filterDate.value // YYYY-MM-DD
    result = result.filter(r => {
      const ts = r.note_updated_at || r.latest_timestamp
      if (!ts) return false
      const d = new Date(ts)
      if (isNaN(d.getTime())) return false
      return d.toISOString().slice(0, 10) === filterDateStr
    })
  }

  return result
})

/**
 * 加载个人学习数据。
 * 并行请求 getProfile（统计/记录/排行榜）和 /api/articles（文章内容，用于片段预览）。
 * 未登录时重定向到登录页；任一请求失败不影响另一请求的结果落库。
 * @returns {Promise<void>}
 */
const loadProfile = async () => {
  try {
    const studentCode = authStore.user_code
    if (!studentCode) {
      router.push('/login')
      return
    }

    // 并行加载：个人数据 + 题库（用于文章内容片段预览）
    // articles 请求失败时返回 null，不影响主数据展示
    const [res, artRes] = await Promise.all([
      getProfile(studentCode),
      fetch('/api/articles').then(r => r.json()).catch(() => null),
    ])

    // 构建文章映射：article_id -> { title, content }
    if (artRes && artRes.success && artRes.data) {
      const map = {}
      for (const a of artRes.data) {
        map[a.id] = { title: a.title || '', content: a.content || '' }
      }
      articlesMap.value = map
    }

    // 主数据落库：统计、记录、排行榜
    if (res.success) {
      stats.value = {
        totalDuration: res.stats?.total_duration || 0,
        completedQuestions: res.stats?.completed_questions || 0,
        initialAccuracy: res.stats?.initial_accuracy || 0,
        finalAccuracy: res.stats?.final_accuracy || 0,
        fixedByAI: res.stats?.fixed_by_ai || 0,
        totalAnswered: res.stats?.total_answered || 0,
        score: res.stats?.score || 0,
        rank: res.stats?.rank || 0,
        totalStudents: res.stats?.total_students || 0,
      }
      records.value = res.records || []
      leaderboard.value = res.leaderboard || []
    }
  } catch (err) {
    // 保留错误日志用于排查加载失败原因
    console.error('加载个人数据失败', err)
  } finally {
    loading.value = false
  }
}

/**
 * 切换指定文章卡片的展开/收起状态（同时只展开一张）。
 * @param {number|string} articleId - 文章 ID
 */
const toggleExpand = (articleId) => {
  expandedArticle.value = expandedArticle.value === articleId ? null : articleId
}

/**
 * 将秒数格式化为可读时长（如 "1h 30m"、"45m"、"30s"）。
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时长字符串
 */
const formatDuration = (seconds) => {
  if (!seconds) return '0m'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${seconds}s`
}

/**
 * 将 ISO 时间字符串格式化为中文本地化日期时间。
 * @param {string} iso - ISO 8601 时间字符串
 * @returns {string} 格式化后的日期时间，如 "2025年8月16日 14:30"
 */
const formatDate = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

/**
 * 截断文本到指定长度，并将换行符替换为空格。
 * @param {string} text - 原始文本
 * @param {number} maxLen - 最大字符数
 * @returns {string} 截断后的文本（超出部分以 "..." 结尾）
 */
const truncate = (text, maxLen) => {
  if (!text) return ''
  const clean = text.replace(/\n+/g, ' ').trim()
  return clean.length > maxLen ? clean.slice(0, maxLen) + '...' : clean
}

/**
 * 获取指定文章的纯文本片段预览。
 * 处理流程：从 articlesMap 取出内容 → 去除 HTML 标签 → 压缩空白 → 截断到 80 字。
 * @param {number|string} articleId - 文章 ID
 * @returns {string} 纯文本片段，无内容时返回空字符串
 */
const getArticleSnippet = (articleId) => {
  const art = articlesMap.value[articleId]
  if (!art || !art.content) return ''
  // 去除 HTML 标签并压缩连续空白为单个空格
  const plain = art.content.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  return truncate(plain, 80)
}

/**
 * 跳转到指定文章的阅读/答题页。
 * @param {number|string} articleId - 文章 ID
 */
const openArticle = (articleId) => {
  router.push({ path: '/task', query: { article: articleId } })
}

/** 返回阅读/答题页 */
const goBack = () => router.push('/task')

/**
 * 管理员导出：导出全部参与者的实验数据为 CSV。
 * 仅 isAdmin 为 true 时可触发。
 */
const exportAll = () => {
  exportAllDataCSV(authStore.user_code)
}

/**
 * 管理员导出：导出当前账号自身的实验数据为 CSV。
 * 仅 isAdmin 为 true 时可触发。
 */
const exportMine = () => {
  exportStudentCSV(authStore.user_code, authStore.user_code)
}

// 页面挂载后加载数据
onMounted(() => {
  loadProfile()
})
</script>

<style scoped>
.profile-page {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  background: #f0f2f5;
  overflow: hidden;
}

.top-nav {
  flex-shrink: 0;
  background: white;
  padding: 0 20px;
  height: 56px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid #e5e7eb;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.back-btn {
  background: none;
  border: none;
  color: #3b82f6;
  cursor: pointer;
  font-size: 0.95rem;
  padding: 6px 12px;
  border-radius: 8px;
  transition: background 0.15s;
}
.back-btn:hover {
  background: #eff6ff;
}
.brand {
  font-size: 1.2rem;
  font-weight: 700;
  color: #1f2937;
  flex: 1;
  margin-left: 12px;
}
.user-code {
  font-size: 0.9rem;
  color: #6b7280;
  background: #f3f4f6;
  padding: 4px 12px;
  border-radius: 20px;
}

.main-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
.loading {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100%;
  font-size: 1.2rem;
  color: #6b7280;
}

.content-wrapper {
  max-width: 1200px;
  margin: 0 auto;
}

/* ========== 统计卡片 ========== */
.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}
.stat-card {
  background: white;
  border-radius: 14px;
  padding: 20px;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  border-top: 3px solid transparent;
  transition: transform 0.15s;
}
.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0,0,0,0.1);
}
.stat-duration { border-top-color: #3b82f6; }
.stat-questions { border-top-color: #10b981; }
.stat-accuracy { border-top-color: #f59e0b; }
.stat-score { border-top-color: #8b5cf6; }

.stat-icon {
  font-size: 1.8rem;
  margin-bottom: 4px;
}
.stat-value {
  font-size: 1.8rem;
  font-weight: 800;
  color: #1f2937;
}
.stat-label {
  font-size: 0.85rem;
  color: #6b7280;
  margin-top: 2px;
}
.stat-sub {
  font-size: 0.75rem;
  color: #9ca3af;
  margin-top: 4px;
}

/* ========== 双栏布局 ========== */
.dual-panel {
  display: grid;
  grid-template-columns: 1fr 380px;
  gap: 20px;
  margin-bottom: 24px;
}

/* ========== 记录面板 ========== */
.records-panel,
.leaderboard-panel {
  background: white;
  border-radius: 14px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #f0f0f0;
}
.panel-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0;
}
.note-total {
  font-size: 0.85rem;
  color: #9ca3af;
  background: #f3f4f6;
  padding: 2px 10px;
  border-radius: 12px;
}

/* 筛选栏 */
.filter-bar {
  display: flex;
  gap: 8px;
  padding: 12px 20px;
  border-bottom: 1px solid #f5f5f5;
}
.filter-input {
  flex: 1;
  padding: 6px 12px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 0.85rem;
  outline: none;
  transition: border-color 0.15s;
}
.filter-input:focus {
  border-color: #3b82f6;
}
.filter-select {
  padding: 6px 10px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  font-size: 0.85rem;
  outline: none;
  cursor: pointer;
}

/* 记录列表 */
.records-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px 20px;
  max-height: 560px;
}
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: #9ca3af;
  font-size: 0.95rem;
}
.record-card {
  background: #fafbfc;
  border: 1px solid #f0f0f0;
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 10px;
  transition: all 0.15s;
}
.record-card:hover {
  border-color: #c7d2fe;
  background: #f5f7ff;
}
.record-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  cursor: pointer;
}
.record-article {
  font-weight: 600;
  font-size: 0.9rem;
  color: #3b82f6;
}
.record-date {
  font-size: 0.8rem;
  color: #9ca3af;
  white-space: nowrap;
}
.article-snippet {
  font-size: 0.85rem;
  color: #4b5563;
  line-height: 1.5;
}
.expand-toggle {
  font-size: 0.78rem;
  color: #6366f1;
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 6px;
  transition: background 0.15s;
}
.expand-toggle:hover {
  background: #ede9fe;
}

.record-section {
  margin-bottom: 8px;
}
.section-label {
  margin-bottom: 4px;
}
.note-content {
  font-size: 0.85rem;
  color: #4b5563;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

/* AI 对话 */
.ai-chat-preview {
  font-size: 0.82rem;
  color: #6b7280;
  line-height: 1.4;
}
.ai-chat-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.chat-item {
  background: #f8f9ff;
  border: 1px solid #e0e7ff;
  border-radius: 8px;
  padding: 8px 10px;
}
.chat-q {
  font-size: 0.82rem;
  font-weight: 600;
  color: #374151;
  margin-bottom: 4px;
}
.chat-a {
  font-size: 0.82rem;
  color: #4b5563;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
}
.chat-meta {
  font-size: 0.72rem;
  color: #9ca3af;
  margin-top: 4px;
}

.note-tag {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
}
.tag-ai {
  background: #ede9fe;
  color: #6d28d9;
}
.tag-mark {
  background: #fef3c7;
  color: #92400e;
}
.tag-manual {
  background: #d1fae5;
  color: #065f46;
}

.record-card-footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
}
.jump-btn {
  background: #3b82f6;
  color: white;
  border: none;
  padding: 4px 14px;
  border-radius: 8px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: opacity 0.15s;
}
.jump-btn:hover {
  opacity: 0.9;
}

/* ========== 排行榜 ========== */
.leaderboard-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px;
  max-height: 540px;
}
.rank-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  margin-bottom: 4px;
  font-size: 0.9rem;
  transition: background 0.1s;
}
.rank-item:hover {
  background: #f9fafb;
}
.rank-me {
  background: #eff6ff;
  border: 1px solid #bfdbfe;
}
.rank-1 .rank-num { color: #f59e0b; font-size: 1.2rem; }
.rank-2 .rank-num { color: #9ca3af; font-size: 1.1rem; }
.rank-3 .rank-num { color: #cd7f32; font-size: 1.1rem; }

.rank-num {
  font-weight: 800;
  font-size: 1rem;
  width: 28px;
  text-align: center;
}
.rank-code {
  flex: 1;
  font-weight: 600;
  color: #1f2937;
}
.rank-score {
  font-weight: 700;
  color: #8b5cf6;
}
.rank-questions {
  font-size: 0.8rem;
  color: #9ca3af;
}

/* ========== 管理员导出 ========== */
.admin-section {
  background: white;
  border-radius: 14px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  border-top: 3px solid #ef4444;
}
.admin-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: #1f2937;
  margin: 0 0 12px 0;
}
.admin-actions {
  display: flex;
  gap: 12px;
  margin-bottom: 8px;
}
.admin-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 10px;
  cursor: pointer;
  font-size: 0.9rem;
  font-weight: 600;
  background: #3b82f6;
  color: white;
  transition: opacity 0.15s;
}
.admin-btn:hover {
  opacity: 0.9;
}
.admin-btn-secondary {
  background: #6366f1;
}
.admin-hint {
  font-size: 0.8rem;
  color: #9ca3af;
  margin: 0;
}
</style>
