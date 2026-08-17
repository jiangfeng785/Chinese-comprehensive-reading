/**
 * Vite 构建配置
 * - Vue 插件 + 路径别名 (@ → src)
 * - 开发服务器代理: /api → 后端 localhost:5000 (生产环境由 Nginx 反向代理)
 */
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src')
    }
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true
      }
    }
  }
})