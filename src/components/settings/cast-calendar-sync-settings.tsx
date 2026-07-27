'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Copy, RefreshCw } from 'lucide-react'

export function CastCalendarSyncSettings({ userId, initialCalendarToken }: { userId: string; initialCalendarToken: string | null }) {
  const [calendarToken, setCalendarToken] = useState(initialCalendarToken)
  const [issuingToken, setIssuingToken] = useState(false)
  const supabase = createClient()

  async function issueCalendarToken() {
    setIssuingToken(true)
    try {
      const token = crypto.randomUUID()
      const { error } = await supabase.from('users').update({ calendar_token: token }).eq('id', userId)
      if (error) { toast.error('URLの発行に失敗しました'); return }
      setCalendarToken(token)
      toast.success('カレンダー連携URLを発行しました')
    } finally {
      setIssuingToken(false)
    }
  }

  async function copyCalendarUrl() {
    if (!calendarToken) return
    const url = `${window.location.origin}/api/calendar/${calendarToken}`
    await navigator.clipboard.writeText(url)
    toast.success('URLをコピーしました')
  }

  return (
    <Card elevated>
      <CardHeader>
        <CardTitle>カレンダー連携</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          専用URLを発行すると、GoogleカレンダーやTimeTreeの「外部カレンダーを購読」機能でシフトを自動的に取り込めます（提出済み・確定済みのシフトが対象）。
        </p>
        {calendarToken ? (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input readOnly value={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/calendar/${calendarToken}`} className="text-xs" />
              <Button size="icon" variant="outline" onClick={copyCalendarUrl}><Copy className="h-3.5 w-3.5" /></Button>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>Googleカレンダー: 「他のカレンダー」→「URLで追加」</span>
              <span>／</span>
              <span>TimeTree: 「カレンダーを読み込む」からこのURLを登録</span>
            </div>
            <Button size="sm" variant="outline" onClick={issueCalendarToken} disabled={issuingToken}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" />URLを再発行（旧URLは無効になります）
            </Button>
          </div>
        ) : (
          <Button variant="elevated" size="sm" onClick={issueCalendarToken} disabled={issuingToken}>
            {issuingToken ? '発行中...' : 'URLを発行'}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
