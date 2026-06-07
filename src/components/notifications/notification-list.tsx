'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Bell, CheckCheck } from 'lucide-react'

interface Notification {
  id: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string
}

export function NotificationList({ notifications: initial, userId }: { notifications: Notification[]; userId: string }) {
  const [notifications, setNotifications] = useState(initial)
  const supabase = createClient()
  const unreadCount = notifications.filter(n => !n.read_at).length

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
        <div>
          <CardTitle>通知</CardTitle>
          {unreadCount > 0 && <p className="text-sm text-muted-foreground mt-0.5">未読 {unreadCount} 件</p>}
        </div>
        {unreadCount > 0 && (
          <Button size="sm" variant="outline" onClick={markAllRead}>
            <CheckCheck className="h-4 w-4 mr-1" />すべて既読
          </Button>
        )}
      </CardHeader>
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
                  'flex gap-3 p-3 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors',
                  !notif.read_at && 'bg-blue-50 hover:bg-blue-100'
                )}
                onClick={() => !notif.read_at && markRead(notif.id)}
              >
                <div className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0', notif.read_at ? 'bg-transparent' : 'bg-blue-500')} />
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
