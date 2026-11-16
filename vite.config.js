import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// 数据更新日期 = 三个禁拍库文件中最新的修改时间（本地时区 YYYY-MM-DD）。
// 这样每次改完 ban/*.json 重新 build，日期自动跟着变，无需手动维护；
// 只改 UI 不动数据则日期保持不变，不会虚报"今天更新"。
function banDataUpdated() {
  const files = ['anheng', 'error', 'long'].map((name) =>
    fileURLToPath(new URL(`./ban/${name}.json`, import.meta.url))
  )
  const latest = files.reduce((max, file) => {
    try {
      return Math.max(max, statSync(file).mtimeMs)
    } catch {
      return max
    }
  }, 0)
  if (!latest) return '未知'
  const d = new Date(latest)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default defineConfig({
  define: {
    __BAN_DATA_UPDATED__: JSON.stringify(banDataUpdated())
  },
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true
      }
    }
  }
})
