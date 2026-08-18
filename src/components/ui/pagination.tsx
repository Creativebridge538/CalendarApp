'use client'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { PAGE_SIZE_OPTIONS } from '@/hooks/use-pagination'

interface Props {
  page: number
  totalPages: number
  pageSize: number
  totalItems: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

export function Pagination({ page, totalPages, pageSize, totalItems, onPageChange, onPageSizeChange }: Props) {
  if (totalItems === 0) return null

  return (
    <div className="flex items-center justify-between flex-wrap gap-2 pt-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>表示件数</span>
        <Select value={String(pageSize)} onValueChange={v => { if (v) onPageSizeChange(Number(v)) }}>
          <SelectTrigger className="h-7 w-[4.5rem] text-xs"><SelectValue>{pageSize}件</SelectValue></SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {PAGE_SIZE_OPTIONS.map(n => <SelectItem key={n} value={String(n)}>{n}件</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="tabular-nums">全{totalItems}件</span>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <Button size="icon" variant="outline" className="h-7 w-7" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="前のページ">
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums">{page} / {totalPages}</span>
          <Button size="icon" variant="outline" className="h-7 w-7" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="次のページ">
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}
