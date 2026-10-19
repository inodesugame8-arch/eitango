/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// テストは日本時間で走らせる（GitHub Actions は世界標準時で動くため）。
// test.env の TZ は pool が threads のとき効かないので、設定を読む時点で変える。
if (process.env.VITEST) process.env.TZ = 'Asia/Tokyo'

// 設定画面に出すコミット（GitHub Actions では GITHUB_SHA、手元では git、どちらも無ければ dev）
function commitHash(): string {
  const sha = process.env.GITHUB_SHA
  if (sha) return sha.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: '/eitango/',
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __COMMIT__: JSON.stringify(commitHash()),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: '英単語',
        short_name: '英単語',
        lang: 'ja',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#ffffff',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // png と webmanifest は入れない。アイコンは includeAssets と manifest のアイコンから、
        // manifest はプラグインが自分で precache に入れるので、ここにも書くと二重に載る
        globPatterns: ['**/*.{js,css,html,svg}'],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
