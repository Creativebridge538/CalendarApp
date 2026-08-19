'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'

interface Props {
  castId: string
  from: string
  to: string
}

// ブラウザの印刷→PDF保存は共有時にレイアウトが崩れることがあるため、
// サーバーで生成した崩れないPDFを正しいファイル名で直接ダウンロードする
export function DownloadPdfButton({ castId, from, to }: Props) {
  const [downloading, setDownloading] = useState(false)

  async function handleDownload() {
    setDownloading(true)
    try {
      const res = await fetch(`/api/rewards/notices/pdf?cast_id=${castId}&from=${from}&to=${to}`)
      if (!res.ok) { toast.error('PDFの生成に失敗しました'); return }
      const disposition = res.headers.get('Content-Disposition') ?? ''
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/)
      const filename = match ? decodeURIComponent(match[1]) : '支払通知書.pdf'

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Button onClick={handleDownload} disabled={downloading} variant="outline">
      <Download className="h-4 w-4 mr-1" />
      {downloading ? '生成中...' : 'PDFダウンロード'}
    </Button>
  )
}
