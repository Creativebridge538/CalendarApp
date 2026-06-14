'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { Database } from '@/lib/supabase/database.types'

type Reward = Database['public']['Tables']['reward_calculations']['Row']

interface Props {
  rewards: Reward[]
}

export function CastRewardView({ rewards }: Props) {
  const sorted = [...rewards].sort((a, b) =>
    b.period_year !== a.period_year
      ? b.period_year - a.period_year
      : b.period_month - a.period_month
  )

  const [index, setIndex] = useState(0)

  if (sorted.length === 0) {
    return <p className="text-muted-foreground text-sm py-8 text-center">まだ明細がありません</p>
  }

  const reward = sorted[index]
  const hasPrev = index < sorted.length - 1
  const hasNext = index > 0

  return (
    <div className="space-y-4">
      {/* 月ナビ */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setIndex(i => i + 1)}
          disabled={!hasPrev}
          className="flex items-center gap-1 px-2 py-1 text-sm rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <ChevronLeft className="h-4 w-4" />
          前の月
        </button>

        <div className="flex flex-col items-center gap-1">
          <span className="text-lg font-bold">
            {reward.period_year}年{reward.period_month}月
          </span>
          <Badge variant={reward.is_finalized ? 'default' : 'secondary'} className="text-xs">
            {reward.is_finalized ? '確定済み' : '暫定'}
          </Badge>
        </div>

        <button
          onClick={() => setIndex(i => i - 1)}
          disabled={!hasNext}
          className="flex items-center gap-1 px-2 py-1 text-sm rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          次の月
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* 月一覧タブ（スクロール） */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {sorted.map((r, i) => (
          <button
            key={r.id}
            onClick={() => setIndex(i)}
            className={cn(
              'flex-shrink-0 px-3 py-1 text-xs rounded-full border transition-colors',
              i === index
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
            )}
          >
            {r.period_year}年{r.period_month}月
          </button>
        ))}
      </div>

      {/* 明細カード */}
      <Card>
        <CardContent className="pt-6 space-y-3">
          <div className="grid grid-cols-2 gap-y-3 text-sm">
            <Row label="売上合計" value={`¥${Number(reward.sales_total).toLocaleString()}`} />
            <Row label="報酬率" value={`${(Number(reward.reward_rate) * 100).toFixed(1)}%`} />
            <Row label="基本報酬" value={`¥${Number(reward.base_reward).toLocaleString()}`} />
            <Row
              label="ボーナス"
              value={`+¥${Number(reward.bonus).toLocaleString()}`}
              valueClass="text-green-600"
            />
            <Row
              label="控除"
              value={`-¥${Number(reward.deduction).toLocaleString()}`}
              valueClass="text-red-600"
            />
          </div>

          <Separator />

          <div className="flex justify-between items-center">
            <span className="font-bold text-base">支払合計</span>
            <span className="font-bold text-xl">¥{Number(reward.total_reward).toLocaleString()}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <>
      <div className="text-muted-foreground">{label}</div>
      <div className={cn('text-right', valueClass)}>{value}</div>
    </>
  )
}
