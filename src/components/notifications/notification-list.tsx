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
import { cn } from '@/lib/utils'
import { Bell, BellRing, BellOff, CheckCheck, Send, ChevronLeft } from 'lucide-react'
import { getPushSubscriptionState, subscribeToPush, unsubscribeFromPush, sendPushNotification } from '@/lib/push'

interface Notification {
  id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string
}

export function NotificationList({ notifications: initial, userId }: { notifications: Notification[]; userId: string }) {
  const [notifications, setNotifications] = useState(initial)
  const [pushState, setPushState] = useState<'unsupported' | 'denied' | 'subscribed' | 'unsubscribed' | 'loading'>('loading')
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

  async function sendTestNotification() {
    const { data, error } = await supabase
      .from('notifications')
      .insert({ user_id: userId, title: 'テスト通知', body: '通知の動作確認です' })
      .select()
      .single()
    if (error || !data) { toast.error('送信に失敗しました'); return }
    sendPushNotification(userId, data.title, data.body, data.link)
    setNotifications([data, ...notifications])
    toast.success('テスト通知を送信しました')
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
