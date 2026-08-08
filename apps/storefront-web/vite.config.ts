import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tanstackRouter(), react()],
  server: {
    port: 5173,
    // ponytail: 全量代理到 storefront API, SPA 与 Vite 内部请求 bypass;
    // HttpOnly session cookie 同源透传, 无需 CORS/.env 改动
    proxy: {
      '/': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        bypass: (req) => {
          const url = req.url ?? ''
          const wantsHtml = req.headers.accept?.includes('text/html')
          const isViteInternal =
            url.startsWith('/@') || url.startsWith('/src/') || url.startsWith('/node_modules/')
          return wantsHtml || isViteInternal ? url : undefined
        },
      },
    },
  },
})
