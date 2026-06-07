'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Calculator, Lock } from 'lucide-react'
import type { Database } from '@/lib/supabase/database.types'

type Reward = Database['public']['Tables']['reward_calculations']['Row']

interface CastUser { id: string; display_name: string | null; reward_rate: number | string }

interface Props {
  casts: CastUser[]
  rewards: Reward[]
  storeId: string
  userId: string
  year: number
  month: number
}

export function RewardCalculator({ casts, rewards: initialRewards, storeId, userId, year, month }: Props) {
  const [rewards, setRewards] = useState(initialRewards)
  const [adjustments, setAdjustments] = useState<Record<string, { bonus: string; deduction: string }>>({})
  const [calculating, setCalculating] = useState(false)
  const supabase = createClient()

  function getAdj(castId: string) {
    return adjustments[castId] ?? { bonus: '0', deduction: '0' }
  }

  async function calculate(cast: CastUser) {
    setCalculating(true)
    const { data: salesData } = await supabase.from('sales')
      .select('amount')
      .eq('cast_id', cast.id)
      .gte('date', `${year}-${String(month).padStart(2, '0')}-01`)
      .lte('date', `${year}-${String(month).padStart(2, '0')}-31`)

    const salesTotal = (salesData ?? []).reduce((sum, s) => sum + Number(s.amount), 0)
    const rewardRate = Number(cast.reward_rate)
    const baseReward = Math.floor(salesTotal * rewardRate)
    const adj = getAdj(cast.id)
    const bonus = parseInt(adj.bonus) || 0
    const deduction = parseInt(adj.deduction) || 0
    const totalReward = baseReward + bonus - deduction

    const payload = {
      cast_id: cast.id, store_id: storeId,
      period_year: year, period_month: month,
      sales_total: salesTotal, reward_rate: rewardRate,
      base_reward: baseReward, bonus, deduction, total_reward: totalReward,
      calculated_by: userId, calculated_at: new Date().toISOString(),
    }

    const existing = rewards.find(r => r.cast_id === cast.id)
    if (existing) {
      const { error } = await supabase.from('reward_calculations').update(payload).eq('id', existing.id)
      if (error) { toast.error('計算に失敗しました'); setCalculating(false); return }
      setRewards(rewards.map(r => r.id === existing.id ? { ...r, ...payload } : r))
    } else {
      const { data, error } = await supabase.from('reward_calculations').insert(payload).select().single()
      if (error) { toast.error('計算に失敗しました'); setCalculating(false); return }
      setRewards([...rewards, data])
    }
    toast.success(`${cast.display_name} の報酬を計算しました`)
    setCalculating(false)
  }

  async function finalize(reward: Reward) {
    if (!confirm('確定すると変更できません。よろしいですか？')) return
    const { error } = await supabase.from('reward_calculations').update({ is_finalized: true }).eq('id', reward.id)
    if (error) { toast.error('確定に失敗しました'); return }
    setRewards(rewards.map(r => r.id === reward.id ? { ...r, is_finalized: true } : r))
    toast.success('明細を確定しました')
    await supabase.from('notifications').insert({
      user_id: reward.cast_id,
      title: '報酬明細が確定されました',
      body: `${year}年${month}月の報酬: ¥${Number(reward.total_reward).toLocaleString()}`,
      link: '/cast/rewards',
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>報酬計算 — {year}年{month}月</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>キャスト</TableHead>
              <TableHead className="text-right">売上合計</TableHead>
              <TableHead className="text-right">報酬率</TableHead>
              <TableHead className="text-right">基本報酬</TableHead>
              <TableHead className="w-28">ボーナス</TableHead>
              <TableHead className="w-28">控除</TableHead>
              <TableHead className="text-right">支払合計</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {casts.map(cast => {
              const reward = rewards.find(r => r.cast_id === cast.id)
              const adj = getAdj(cast.id)
              const isFinalized = reward?.is_finalized

              return (
                <TableRow key={cast.id}>
                  <TableCell className="font-medium">{cast.display_name ?? '—'}</TableCell>
                  <TableCell className="text-right">{reward ? `¥${Number(reward.sales_total).toLocaleString()}` : '—'}</TableCell>
                  <TableCell className="text-right">{(Number(cast.reward_rate) * 100).toFixed(1)}%</TableCell>
                  <TableCell className="text-right">{reward ? `¥${Number(reward.base_reward).toLocaleString()}` : '—'}</TableCell>
                  <TableCell>
                    <Input type="number" className="h-8 text-sm" value={adj.bonus} disabled={!!isFinalized}
                      onChange={e => setAdjustments({ ...adjustments, [cast.id]: { ...adj, bonus: e.target.value } })} />
                  </TableCell>
                  <TableCell>
                    <Input type="number" className="h-8 text-sm" value={adj.deduction} disabled={!!isFinalized}
                      onChange={e => setAdjustments({ ...adjustments, [cast.id]: { ...adj, deduction: e.target.value } })} />
                  </TableCell>
                  <TableCell className="text-right font-bold">
                    {reward ? `¥${Number(reward.total_reward).toLocaleString()}` : '—'}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    {isFinalized ? (
                      <Badge><Lock className="h-3 w-3 mr-1" />確定済み</Badge>
                    ) : (
                      <>
                        <Button size="sm" variant="outline" onClick={() => calculate(cast)} disabled={calculating}>
                          <Calculator className="h-3.5 w-3.5 mr-1" />計算
                        </Button>
                        {reward && (
                          <Button size="sm" onClick={() => finalize(reward)}>確定</Button>
                        )}
                      </>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
