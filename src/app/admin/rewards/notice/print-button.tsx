'use client'

import { Button } from '@/components/ui/button'
import { Printer } from 'lucide-react'

export function PrintButton() {
  return (
    <Button onClick={() => window.print()}>
      <Printer className="h-4 w-4 mr-1" />
      印刷／PDF保存
    </Button>
  )
}
