import type { MetadataRoute } from 'next'
import { APP_NAME } from '@/lib/app-config'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: '多店舗対応シフト・報酬・キャスト管理',
    start_url: '/cast/shifts',
    scope: '/',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#0a0b0d',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
