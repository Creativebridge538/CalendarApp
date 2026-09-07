import type { Metadata } from 'next'
import { Geist, Noto_Sans_JP, Zen_Maru_Gothic, M_PLUS_Rounded_1c, Kosugi_Maru, Mochiy_Pop_One, Kiwi_Maru, Hachi_Maru_Pop } from 'next/font/google'
import './globals.css'
import { Toaster } from '@/components/ui/sonner'
import { APP_NAME } from '@/lib/app-config'

const geist = Geist({ subsets: ['latin'] })

// 着せ替えフォント（配色スキンとは別軸）ごとに切り替えるための読み込み。
// 実際にダウンロードされるのは選ばれたフォントで使う文字だけ（未選択なら実質リクエストされない）。
const notoSansJP = Noto_Sans_JP({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-noto-sans-jp' })
const zenMaruGothic = Zen_Maru_Gothic({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-zen-maru-gothic' })
const mplusRounded = M_PLUS_Rounded_1c({ subsets: ['latin'], weight: ['500', '700'], variable: '--font-mplus-rounded' })
const kosugiMaru = Kosugi_Maru({ subsets: ['latin'], weight: '400', variable: '--font-kosugi-maru' })
const mochiyPopOne = Mochiy_Pop_One({ subsets: ['latin'], weight: '400', variable: '--font-mochiy-pop-one' })
const kiwiMaru = Kiwi_Maru({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-kiwi-maru' })
const hachiMaruPop = Hachi_Maru_Pop({ subsets: ['latin'], weight: '400', variable: '--font-hachi-maru-pop' })

const accentFontVars = [notoSansJP, zenMaruGothic, mplusRounded, kosugiMaru, mochiyPopOne, kiwiMaru, hachiMaruPop]
  .map(f => f.variable)
  .join(' ')

export const metadata: Metadata = {
  title: `${APP_NAME} - 業務管理システム`,
  description: '多店舗対応シフト・報酬・キャスト管理',
}

export const viewport = {
  themeColor: '#0a0b0d',
  viewportFit: 'cover' as const,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className={`${geist.className} ${accentFontVars} h-full antialiased`}>
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  )
}
