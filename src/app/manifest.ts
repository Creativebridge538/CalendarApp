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
      { src: '/api/app-icon?size=192', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/api/app-icon?size=512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
