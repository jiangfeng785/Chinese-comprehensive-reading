<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 px-4">
    <div class="max-w-md w-full bg-white rounded-xl shadow-lg p-8">
      <h1 class="text-3xl font-bold text-center text-blue-600 mb-2">📖 L2中文阅读研究平台</h1>
      <p class="text-center text-gray-500 mb-8">请使用研究者分配的编号登录</p>

      <form @submit.prevent="handleLogin" class="space-y-6">
        <div>
          <label class="block text-sm font-medium text-gray-700">参与者编号</label>
          <input
            v-model="userCode"
            type="text"
            required
            placeholder="例如：test001"
            class="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700">密码</label>
          <input
            v-model="password"
            type="password"
            placeholder="默认 123456"
            class="mt-1 w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>

        <button
          type="submit"
          :disabled="loading"
          class="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition disabled:opacity-50"
        >
          {{ loading ? '登录中...' : '登录并开始校准' }}
        </button>
      </form>

      <p class="mt-4 text-xs text-gray-400 text-center">
        研究任务平台 · 数据仅用于学术分析
      </p>
    </div>
  </div>
</template>

<script setup>
/**
 * LoginPage.vue - 登录页面（模拟登录）
 *
 * 功能说明：
 *   - 参与者通过编号 + 密码登录研究平台
 *   - 调用后端 /api/auth/login 接口进行身份验证
 *   - 登录成功后将用户信息写入 Pinia store，并跳转至校准页
 *
 * 依赖：
 *   - vue-router：页面跳转
 *   - Pinia useAuthStore：全局用户状态管理
 *   - axios：HTTP 请求
 */
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/useAuthStore'
import axios from 'axios'

const router = useRouter()
const authStore = useAuthStore()

// 表单状态
const userCode = ref('')        // 参与者编号
const password = ref('123456')  // 默认密码
const loading = ref(false)      // 登录中加载态

/**
 * 处理登录表单提交。
 * 校验编号非空后请求后端验证，成功则写入 Pinia 并跳转校准页。
 * @async
 * @returns {Promise<void>}
 */
const handleLogin = async () => {
  if (!userCode.value.trim()) {
    alert('请输入参与者编号')
    return
  }

  loading.value = true
  try {
    const res = await axios.post('/api/auth/login', {
      user_code: userCode.value.trim(),
      password: password.value
    })

    if (res.data.success) {
      // 保存用户信息到 Pinia
      authStore.login({
        user_id: res.data.user_id,
        user_code: res.data.user_code
      })
      // 跳转到校准页
      router.push('/calibration')
    } else {
      alert(res.data.message || '登录失败，请检查编号和密码')
    }
  } catch (error) {
    // 网络或服务异常日志（保留以便排查后端未启动等常见问题）
    console.error('登录请求失败', error)
    alert('网络错误，请确保后端服务已启动')
  } finally {
    loading.value = false
  }
}
</script>