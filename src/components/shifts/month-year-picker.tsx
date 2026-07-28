'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface Props {
  value: Date
  onChange: (date: Date) => void
  children: React.ReactNode
  className?: string
}

/** 見出しの年月表示をタップすると、年・月を直接選んで一気にジャンプできるダイアログを開く */
export function MonthYearPicker({ value, onChange, children, className }: Props) {
  const [open, setOpen] = useState(false)
  const year = value.getFullYear()
  const month = value.getMonth() + 1
  const years = Array.from({ length: 7 }, (_, i) => year - 3 + i)

  function jump(nextYear: number, nextMonth: number) {
    onChange(new Date(nextYear, nextMonth - 1, 1))
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn('appearance-none bg-transparent border-0 p-0 m-0 font-inherit text-inherit cursor-pointer hover:opacity-70 transition-opacity', className)}
      >
        {children}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xs">
          <DialogHeader>
            <DialogTitle>年月を選択</DialogTitle>
          </DialogHeader>
          <div className="flex gap-2">
            <Select value={String(year)} onValueChange={v => jump(Number(v), month)}>
              <SelectTrigger className="flex-1">
                <SelectValue>{year}年</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {years.map(y => <SelectItem key={y} value={String(y)}>{y}年</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={String(month)} onValueChange={v => jump(year, Number(v))}>
              <SelectTrigger className="flex-1">
                <SelectValue>{month}月</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                  <SelectItem key={m} value={String(m)}>{m}月</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
