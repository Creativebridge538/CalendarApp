'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { Bell, BellRing, BellOff, CheckCheck, Send, ChevronLeft } from 'lucide-react'
import { getPushSubscriptionState, subscribeToPush, unsubscribeFromPush } from '@/lib/push'

interface Notification {
  id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string
}

interface Props {
  notifications: Notification[]
  userId: string
  /** 管理者の場合のみ渡される。指定するとキャストへのテスト通知送信UIを表示する */
  casts?: { id: string; display_name: string | null }[]
}

export function NotificationList({ notifications: initial, userId, casts }: Props) {
  const [notifications, setNotifications] = useState(initial)
  const [pushState, setPushState] = useState<'unsupported' | 'denied' | 'subscribed' | 'unsubscribed' | 'loading'>('loading')
  const [testCastId, setTestCastId] = useState('')
  const [sendingCastTest, setSendingCastTest] = useState(false)
  const supabase = createClient()
  const router = useRouter()
  const unreadCount = notifications.filter(n => !n.read_at).length

  useEffect(() => {
    getPushSubscriptionState().then(setPushState).catch(() => setPushState('unsupported'))
  }, [])

  async function togglePush() {
    try {
      if (pushState === 'subscribed') {
        await unsubscribeFromPush()
        setPushState('unsubscribed')
        toast.success('プッシュ通知をオフにしました')
      } else {
        await subscribeToPush(userId)
        setPushState('subscribed')
        toast.success('プッシュ通知をオンにしました')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'プッシュ通知の設定に失敗しました')
    }
  }

  // プッシュ送信の結果をその場で確認できるよう、テスト時だけ結果を待って表示する
  // （通常のsendPushNotificationは呼び出し元をブロックしないよう握りつぶす設計のため、ここでは使わない）
  async function sendAndReportPush(targetUserId: string, title: string, body: string | null, link: string | null, targetLabel: string) {
    try {
      const res = await fetch('/api/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: targetUserId, title, body, link }),
      })
      const result = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(`${targetLabel}へのプッシュ送信エラー: ${result.error ?? res.status}`)
      } else if (result.sent === 0 && result.total > 0) {
        const detail = (result.failures ?? [])
          .map((f: { statusCode?: number; message?: string; body?: string }) => `${f.statusCode ?? '?'} ${f.message ?? f.body ?? ''}`.trim())
          .join(' / ')
        toast.error(`${targetLabel}へのプッシュ送信失敗（${result.total}件中0件成功）${detail ? `: ${detail}` : ''}`, { duration: 15000 })
      } else if (result.total === 0) {
        toast.error(`${targetLabel}はプッシュ通知の購読が見つかりません（端末で通知をオンにできているか確認してください）`)
      } else {
        toast.success(`${targetLabel}へテスト通知を送信しました（プッシュ ${result.sent}/${result.total}件成功）`)
      }
    } catch {
      toast.error('プッシュ送信リクエストに失敗しました（ネットワークエラー）')
    }
  }

  async function sendTestNotification() {
    const { data, error } = await supabase
      .from('notifications')
      .insert({ user_id: userId, title: 'テスト通知', body: '通知の動作確認です' })
      .select()
      .single()
    if (error || !data) { toast.error('送信に失敗しました'); return }
    setNotifications([data, ...notifications])
    await sendAndReportPush(userId, data.title, data.body, data.link, '自分')
  }

  async function sendTestToCast() {
    if (!testCastId) { toast.error('キャストを選択してください'); return }
    const castName = casts?.find(c => c.id === testCastId)?.display_name ?? 'キャスト'
    setSendingCastTest(true)
    const { data, error } = await supabase
      .from('notifications')
      .insert({ user_id: testCastId, title: 'テスト通知', body: '管理者からの通知テストです' })
      .select()
      .single()
    if (error || !data) { toast.error('送信に失敗しました'); setSendingCastTest(false); return }
    await sendAndReportPush(testCastId, data.title, data.body, data.link, castName)
    setSendingCastTest(false)
  }

  async function markRead(id: string) {
    const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
    if (error) return
    setNotifications(notifications.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
  }

  async function markAllRead() {
    const unread = notifications.filter(n => !n.read_at).map(n => n.id)
    if (!unread.length) return
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', unread)
    setNotifications(notifications.map(n => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })))
    toast.success('すべて既読にしました')
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => router.back()}
            className="p-1 -ml-1 rounded-full hover:bg-muted text-muted-foreground shrink-0"
            aria-label="戻る"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div>
            <CardTitle>通知</CardTitle>
            {unreadCount > 0 && <p className="text-sm text-muted-foreground mt-0.5">未読 {unreadCount} 件</p>}
          </div>
        </div>
        {unreadCount > 0 && (
          <Button size="sm" variant="outline" onClick={markAllRead}>
            <CheckCheck className="h-4 w-4 mr-1" />すべて既読
          </Button>
        )}
      </CardHeader>
      {pushState === 'unsupported' && (
        <div className="px-6 pb-4 text-sm">
          <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
            <p className="font-medium flex items-center gap-1.5">
              <BellOff className="h-3.5 w-3.5 shrink-0" />
              このブラウザではプッシュ通知が使えません
            </p>
            <p className="text-xs text-muted-foreground">
              iPhoneの場合、Safariでこのサイトをホーム画面に追加してから、そのアイコンで開くとオンにできます。
            </p>
            <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-0.5 pt-0.5">
              <li>Safariの共有ボタン（□に↑のマーク）をタップ</li>
              <li>「ホーム画面に追加」を選ぶ</li>
              <li>ホーム画面に追加されたアイコンからこのアプリを開き直す</li>
              <li>この画面で「オンにする」をタップ</li>
            </ol>
          </div>
        </div>
      )}
      {pushState === 'unsubscribed' && (
        <div className="px-6 pb-3">
          <div className="rounded-lg border p-3 space-y-1" style={{ borderColor: 'var(--brand-accent)', backgroundColor: 'color-mix(in oklch, var(--brand-accent) 8%, transparent)' }}>
            <p className="text-sm font-medium flex items-center gap-1.5">
              <BellRing className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--brand-accent)' }} />
              通知をオンにしませんか?
            </p>
            <p className="text-xs text-muted-foreground">
              シフトの確定・差し戻しや修正申請の結果を、アプリを開かなくても受け取れます。下の「オンにする」から設定できます。
            </p>
          </div>
        </div>
      )}
      {pushState !== 'loading' && pushState !== 'unsupported' && (
        <div className="px-6 pb-3 space-y-2 text-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            {pushState === 'denied' ? (
              <p className="text-muted-foreground flex items-center gap-1.5">
                <BellOff className="h-3.5 w-3.5 shrink-0" />
                プッシュ通知がブラウザでブロックされています。ブラウザの通知設定から許可してください
              </p>
            ) : (
              <>
                <p className="text-muted-foreground flex items-center gap-1.5">
                  {pushState === 'subscribed' ? <BellRing className="h-3.5 w-3.5 shrink-0" /> : <BellOff className="h-3.5 w-3.5 shrink-0" />}
                  プッシュ通知（アプリを開いていなくても通知を受け取れます）
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  {pushState === 'subscribed' && (
                    <Button size="sm" variant="outline" onClick={sendTestNotification}>
                      <Send className="h-3.5 w-3.5 mr-1" />通知テスト
                    </Button>
                  )}
                  <Button size="sm" variant={pushState === 'subscribed' ? 'outline' : 'default'} onClick={togglePush}>
                    {pushState === 'subscribed' ? 'オフにする' : 'オンにする'}
                  </Button>
                </div>
              </>
            )}
          </div>
          {pushState !== 'denied' && (
            <p className="text-xs text-muted-foreground">
              iPhoneでは、Safariでホーム画面に追加してそのアイコンから開いた場合のみ通知を受け取れます。
            </p>
          )}
        </div>
      )}
      {casts && (
        <div className="px-6 pb-4">
          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Send className="h-3.5 w-3.5 shrink-0" />キャストへテスト通知を送信
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={testCastId} onValueChange={v => { if (v) setTestCastId(v) }}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="キャストを選択">
                    {testCastId ? (casts.find(c => c.id === testCastId)?.display_name ?? testCastId) : undefined}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {casts.map(c => <SelectItem key={c.id} value={c.id}>{c.display_name ?? c.id}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" variant="outline" onClick={sendTestToCast} disabled={sendingCastTest || !testCastId}>
                <Send className="h-3.5 w-3.5 mr-1" />{sendingCastTest ? '送信中...' : 'テスト送信'}
              </Button>
            </div>
          </div>
        </div>
      )}
      <CardContent>
        {notifications.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Bell className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p>通知はありません</p>
          </div>
        )}
        <div className="space-y-1">
          {notifications.map(notif => {
            const content = (
              <div
                className={cn(
                  'flex gap-3 p-3 rounded-lg cursor-pointer hover:bg-accent transition-colors',
                  !notif.read_at && 'bg-primary/10 hover:bg-primary/15'
                )}
                onClick={() => !notif.read_at && markRead(notif.id)}
              >
                <div className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', notif.read_at ? 'bg-transparent' : 'bg-primary')} />
                <div className="flex-1 min-w-0">
                  <p className={cn('text-sm', !notif.read_at && 'font-medium')}>{notif.title}</p>
                  {notif.body && <p className="text-xs text-muted-foreground mt-0.5">{notif.body}</p>}
                  <p className="text-xs text-muted-foreground mt-1">
                    {format(new Date(notif.created_at), 'M/d HH:mm', { locale: ja })}
                  </p>
                </div>
              </div>
            )
            return notif.link ? <Link key={notif.id} href={notif.link}>{content}</Link> : <div key={notif.id}>{content}</div>
          })}
        </div>
      </CardContent>
    </Card>
  )
}
