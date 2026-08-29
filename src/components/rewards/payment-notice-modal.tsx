'use client'

import { useState } from 'react'
import { FileText } from 'lucide-react'
import { Button, type buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import type { VariantProps } from 'class-variance-authority'

interface Props {
  castId: string
  /** yyyy-MM-dd */
  from: string
  /** yyyy-MM-dd */
  to: string
  /** 特定の発行済み通知書を指す場合に指定する。省略時は管理画面では常に最新内容のプレビューになる */
  noticeId?: string | null
  label: string
  variant?: VariantProps<typeof buttonVariants>['variant']
  size?: VariantProps<typeof buttonVariants>['size']
  className?: string
  /** 支払通知書の発行（作成）一覧からのプレビューなど、ダウンロード操作が不要な場面で指定する */
  hideDownload?: boolean
}

export function PaymentNoticeButton({ castId, from, to, noticeId, label, variant = 'ghost', size = 'sm', className, hideDownload }: Props) {
  const [open, setOpen] = useState(false)
  const noticeParam = noticeId ? `&notice_id=${noticeId}` : ''
  const hideDownloadParam = hideDownload ? '&hide_download=1' : ''

  return (
    <>
      <Button size={size} variant={variant} className={className} onClick={() => setOpen(true)}>
        <FileText className="h-3.5 w-3.5 mr-1" />{label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[95vw] max-w-4xl sm:max-w-4xl h-[90dvh] max-h-[90dvh] p-0 gap-0 overflow-hidden">
          <DialogTitle className="sr-only">支払通知書</DialogTitle>
          {open && (
            <iframe
              src={`/admin/rewards/notice?cast_id=${castId}&from=${from}&to=${to}${noticeParam}${hideDownloadParam}`}
              title="支払通知書"
              className="w-full h-full border-0 rounded-xl"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
