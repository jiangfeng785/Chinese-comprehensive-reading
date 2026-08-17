// frontend/src/main.js
// 应用入口 - 移除 pinia-plugin-persistedstate, 不再使用 localStorage 持久化
// 所有实验数据通过 tracker 采集后存入后端 MySQL
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'

const app = createApp(App)

const pinia = createPinia()

app.use(pinia)
app.use(router)
app.mount('#app')