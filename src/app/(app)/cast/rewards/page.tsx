import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

export default async function CastRewardsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: rewards } = await supabase
    .from('reward_calculations')
    .select('*')
    .eq('cast_id', user.id)
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false })
    .limit(12)

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">報酬明細</h1>
      {(!rewards || rewards.length === 0) && (
        <p className="text-muted-foreground">明細がありません</p>
      )}
      {rewards?.map(reward => (
        <Card key={reward.id}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-base">{reward.period_year}年{reward.period_month}月</CardTitle>
            <Badge variant={reward.is_finalized ? 'default' : 'secondary'}>
              {reward.is_finalized ? '確定済み' : '暫定'}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="text-muted-foreground">売上合計</div>
              <div className="text-right">¥{Number(reward.sales_total).toLocaleString()}</div>
              <div className="text-muted-foreground">報酬率</div>
              <div className="text-right">{(Number(reward.reward_rate) * 100).toFixed(1)}%</div>
              <div className="text-muted-foreground">基本報酬</div>
              <div className="text-right">¥{Number(reward.base_reward).toLocaleString()}</div>
              <div className="text-muted-foreground">ボーナス</div>
              <div className="text-right text-green-600">+¥{Number(reward.bonus).toLocaleString()}</div>
              <div className="text-muted-foreground">控除</div>
              <div className="text-right text-red-600">-¥{Number(reward.deduction).toLocaleString()}</div>
            </div>
            <Separator />
            <div className="flex justify-between font-bold">
              <span>支払合計</span>
              <span>¥{Number(reward.total_reward).toLocaleString()}</span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
