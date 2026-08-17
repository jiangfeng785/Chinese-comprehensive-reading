// frontend/src/router/index.js
// ==================== 路由配置 ====================
// 定义页面路由表, 所有页面组件均使用懒加载以优化首屏性能

import { createRouter, createWebHistory } from 'vue-router'

// 懒加载页面组件
const LoginPage = () => import('@/pages/LoginPage.vue')
const CalibrationPage = () => import('@/pages/CalibrationPage.vue')
const ReadingTaskPage = () => import('@/pages/ReadingTaskPage.vue')
const ProfilePage = () => import('@/pages/ProfilePage.vue')

const routes = [
  { path: '/', redirect: '/login' },
  { path: '/login', component: LoginPage },
  { path: '/calibration', component: CalibrationPage },
  { path: '/task', component: ReadingTaskPage },
  { path: '/profile', component: ProfilePage }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router