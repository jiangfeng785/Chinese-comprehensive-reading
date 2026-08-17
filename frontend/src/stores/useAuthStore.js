// frontend/src/stores/useAuthStore.js
// 认证状态管理 - 使用 sessionStorage 持久化登录态
// 答题数据通过后端 MySQL 存储; 登录态用 sessionStorage 保证刷新不丢失
import { defineStore } from 'pinia'

const STORAGE_KEY = 'reading_auth'

function loadFromStorage() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch (e) { /* ignore */ }
  return null
}

function saveToStorage(data) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (e) { /* ignore */ }
}

function clearStorage() {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch (e) { /* ignore */ }
}

const saved = loadFromStorage()

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user_id: saved?.user_id || null,
    user_code: saved?.user_code || null
  }),
  actions: {
    /**
     * 登录: 写入用户信息并持久化到 sessionStorage
     * @param {Object} userData - 登录返回的用户数据
     *   - user_id: 用户ID
     *   - user_code: 用户编号 (学号)
     */
    login(userData) {
      this.user_id = userData.user_id
      this.user_code = userData.user_code
      saveToStorage({ user_id: this.user_id, user_code: this.user_code })
    },
    /**
     * 登出: 清除用户信息并移除 sessionStorage 持久化数据
     */
    logout() {
      this.user_id = null
      this.user_code = null
      clearStorage()
    }
  }
})