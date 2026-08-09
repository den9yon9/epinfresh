import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tanstackRouter(), tailwindcss(), react()],
  server: {
    port: 5174,
    // ponytail: 与 storefront-web 同款方案: 全量代理到 admin API,
    // HttpOnly session cookie 同源透传, 无需 CORS/.env 改动
    proxy: {
      '/': {
        target: 'http://localhost:3001',
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
