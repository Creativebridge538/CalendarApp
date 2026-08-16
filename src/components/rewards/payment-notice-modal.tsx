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
  label: string
  variant?: VariantProps<typeof buttonVariants>['variant']
  size?: VariantProps<typeof buttonVariants>['size']
  className?: string
}

export function PaymentNoticeButton({ castId, from, to, label, variant = 'ghost', size = 'sm', className }: Props) {
  const [open, setOpen] = useState(false)

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
              src={`/admin/rewards/notice?cast_id=${castId}&from=${from}&to=${to}`}
              title="支払通知書"
              className="w-full h-full border-0 rounded-xl"
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
