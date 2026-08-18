import { useMemo, useState } from 'react'

export const PAGE_SIZE_OPTIONS = [30, 50, 100] as const

export function usePagination<T>(items: T[], defaultPageSize: number = PAGE_SIZE_OPTIONS[0]) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSizeRaw] = useState<number>(defaultPageSize)

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize))
  const clampedPage = Math.min(page, totalPages)
  const paged = useMemo(
    () => items.slice((clampedPage - 1) * pageSize, clampedPage * pageSize),
    [items, clampedPage, pageSize]
  )

  function setPageSize(size: number) {
    setPageSizeRaw(size)
    setPage(1)
  }

  return { page: clampedPage, setPage, pageSize, setPageSize, totalPages, paged, totalItems: items.length }
}
