import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // 代理所有 /api 请求到本机 wechat-mp-tools Flask 服务
    // 前端代码用相对路径 /api/... 即可，避免 CORS
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5200',
        changeOrigin: true,
      },
    },
  },
})
