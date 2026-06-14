'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

const THEMES = [
  {
    id: 'default',
    label: 'Mono',
    desc: 'シンプルなモノクロ',
    sidebar: '#ffffff',
    sidebarBorder: '#e5e7eb',
    accent: '#111827',
    mainBg: '#f8fafc',
    dark: false,
  },
  {
    id: 'rose',
    label: 'Rose',
    desc: '華やかなローズピンク',
    sidebar: '#ffffff',
    sidebarBorder: '#ffe4e6',
    accent: '#e11d48',
    mainBg: '#f8fafc',
    dark: false,
  },
  {
    id: 'emerald',
    label: 'Emerald',
    desc: 'クールなエメラルドグリーン',
    sidebar: '#ffffff',
    sidebarBorder: '#d1fae5',
    accent: '#059669',
    mainBg: '#f8fafc',
    dark: false,
  },
  {
    id: 'midnight',
    label: 'Midnight',
    desc: 'ダークネイビー',
    sidebar: '#1a2744',
    sidebarBorder: '#1a2744',
    accent: '#6366f1',
    mainBg: '#18233a',
    dark: true,
  },
  {
    id: 'gold',
    label: 'Gold',
    desc: '上品なゴールド',
    sidebar: '#1c1610',
    sidebarBorder: '#1c1610',
    accent: '#d97706',
    mainBg: '#1a140a',
    dark: true,
  },
  {
    id: 'violet',
    label: 'Violet',
    desc: 'ミステリアスなヴァイオレット',
    sidebar: '#1e1235',
    sidebarBorder: '#1e1235',
    accent: '#7c3aed',
    mainBg: '#160f2a',
    dark: true,
  },
]

interface Props {
  store: { id: string; name: string } | null
  settings: {
    id: string
    deadline_type: string
    deadline_day: number
    require_approval_after_deadline: boolean
    location_mode: string
    area_label: string
    room_label: string
    theme?: string
  } | null
  storeId: string
}

export function StoreSettings({ store: initialStore, settings: initialSettings, storeId }: Props) {
  const [storeName, setStoreName] = useState(initialStore?.name ?? '')
  const [deadlineType, setDeadlineType] = useState(initialSettings?.deadline_type ?? 'monthly')
  const [deadlineDay, setDeadlineDay] = useState(String(initialSettings?.deadline_day ?? 25))
  const [requireApproval, setRequireApproval] = useState(initialSettings?.require_approval_after_deadline ?? true)
  const [locationMode, setLocationMode] = useState(initialSettings?.location_mode ?? 'room')
  const [areaLabel, setAreaLabel] = useState(initialSettings?.area_label ?? 'エリア')
  const [roomLabel, setRoomLabel] = useState(initialSettings?.room_label ?? 'ルーム')
  const [theme, setTheme] = useState(initialSettings?.theme ?? 'default')
  const supabase = createClient()
  const router = useRouter()

  async function saveStoreName() {
    if (initialStore) {
      const { error } = await supabase.from('stores').update({ name: storeName }).eq('id', storeId)
      if (error) { toast.error('保存に失敗しました'); return }
    } else {
      const { error } = await supabase.from('stores').insert({ id: storeId, name: storeName })
      if (error) { toast.error('保存に失敗しました'); return }
    }
    toast.success('店舗名を保存しました')
  }

  async function saveLocationSettings() {
    const payload = { location_mode: locationMode, area_label: areaLabel, room_label: roomLabel }
    if (initialSettings) {
      const { error } = await supabase.from('store_settings').update(payload).eq('id', initialSettings.id)
      if (error) { toast.error('保存に失敗しました'); return }
    } else {
      const { error } = await supabase.from('store_settings').insert({ ...payload, store_id: storeId })
      if (error) { toast.error('保存に失敗しました'); return }
    }
    toast.success('ロケーション設定を保存しました')
  }

  async function saveTheme() {
    if (initialSettings) {
      const { error } = await supabase.from('store_settings').update({ theme } as never).eq('id', initialSettings.id)
      if (error) { toast.error('保存に失敗しました'); return }
    } else {
      const { error } = await supabase.from('store_settings').insert({ theme, store_id: storeId } as never)
      if (error) { toast.error('保存に失敗しました'); return }
    }
    toast.success('テーマを変更しました')
    router.refresh()
  }

  async function saveDeadlineSettings() {
    const payload = {
      store_id: storeId,
      deadline_type: deadlineType as 'monthly' | 'weekly',
      deadline_day: parseInt(deadlineDay),
      require_approval_after_deadline: requireApproval,
    }
    if (initialSettings) {
      const { error } = await supabase.from('store_settings').update(payload).eq('id', initialSettings.id)
      if (error) { toast.error('保存に失敗しました'); return }
    } else {
      const { error } = await supabase.from('store_settings').insert(payload)
      if (error) { toast.error('保存に失敗しました'); return }
    }
    toast.success('締切設定を保存しました')
  }

  return (
    <div className="space-y-6 max-w-lg">
      <Card>
        <CardHeader><CardTitle>店舗情報</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>店舗名</Label>
            <Input value={storeName} onChange={e => setStoreName(e.target.value)} />
          </div>
          <Button onClick={saveStoreName}>保存</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>デザインテーマ</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {THEMES.map(t => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`rounded-xl overflow-hidden text-left transition-all ring-2 ${
                  theme === t.id
                    ? 'ring-white shadow-lg shadow-black/30 scale-[1.02]'
                    : 'ring-transparent hover:ring-white/40'
                }`}
              >
                {/* プレビュー */}
                <div className="flex h-16">
                  {/* サイドバー */}
                  <div
                    className="w-8 shrink-0 flex flex-col gap-1 p-1.5"
                    style={{ backgroundColor: t.sidebar, borderRight: `1px solid ${t.sidebarBorder}` }}
                  >
                    {[0, 1, 2].map(i => (
                      <div
                        key={i}
                        className="h-1.5 rounded-full"
                        style={{ backgroundColor: i === 0 ? t.accent : `${t.accent}44`, width: i === 0 ? '100%' : '70%' }}
                      />
                    ))}
                  </div>
                  {/* コンテンツ */}
                  <div className="flex-1 p-1.5 flex flex-col gap-1" style={{ backgroundColor: t.mainBg }}>
                    <div className="h-2 w-3/4 rounded-full" style={{ backgroundColor: t.dark ? 'rgba(255,255,255,0.15)' : '#e5e7eb' }} />
                    <div className="h-4 w-1/2 rounded" style={{ backgroundColor: t.accent }} />
                    <div className="h-2 w-2/3 rounded-full" style={{ backgroundColor: t.dark ? 'rgba(255,255,255,0.08)' : '#f3f4f6' }} />
                  </div>
                </div>
                <div className="px-2 py-1.5 bg-white">
                  <p className="text-xs font-bold">{t.label}</p>
                  <p className="text-[10px] text-gray-500">{t.desc}</p>
                </div>
              </button>
            ))}
          </div>
          <Button onClick={saveTheme}>テーマを保存</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>ロケーション設定</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>ロケーションモード</Label>
            <Select value={locationMode} onValueChange={v => { if (v) setLocationMode(v) }}>
              <SelectTrigger>
                <SelectValue>
                  {{ none: 'なし（ロケーション選択なし）', room: 'ルームのみ', area_only: 'エリアのみ', area_and_room: 'エリア → ルーム' }[locationMode] ?? locationMode}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">なし（ロケーション選択なし）</SelectItem>
                <SelectItem value="room">ルームのみ</SelectItem>
                <SelectItem value="area_only">エリアのみ</SelectItem>
                <SelectItem value="area_and_room">エリア → ルーム</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">シフト提出時にキャストが選択するロケーションの種類</p>
          </div>
          {(locationMode === 'area_only' || locationMode === 'area_and_room') && (
            <div className="space-y-1.5">
              <Label>エリアの呼び名</Label>
              <Input value={areaLabel} onChange={e => setAreaLabel(e.target.value)} placeholder="例: エリア、フロア、ゾーン" />
            </div>
          )}
          {(locationMode === 'room' || locationMode === 'area_and_room') && (
            <div className="space-y-1.5">
              <Label>ルームの呼び名</Label>
              <Input value={roomLabel} onChange={e => setRoomLabel(e.target.value)} placeholder="例: ルーム、席、テーブル" />
            </div>
          )}
          <Button onClick={saveLocationSettings}>保存</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>締切ルール</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>締切タイプ</Label>
            <Select value={deadlineType} onValueChange={v => { if (v) setDeadlineType(v) }}>
              <SelectTrigger>
                <SelectValue>
                  {deadlineType === 'monthly' ? '月次（毎月X日）' : '週次（毎週X曜日）'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">月次（毎月X日）</SelectItem>
                <SelectItem value="weekly">週次（毎週X曜日）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{deadlineType === 'monthly' ? '締切日（1〜31）' : '締切曜日（0=日〜6=土）'}</Label>
            <Input type="number" min={0} max={deadlineType === 'monthly' ? 31 : 6}
              value={deadlineDay} onChange={e => setDeadlineDay(e.target.value)} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">締切後の修正に承認を必要とする</p>
              <p className="text-xs text-muted-foreground">OFFにすると締切後でも自由に修正できます</p>
            </div>
            <Switch checked={requireApproval} onCheckedChange={setRequireApproval} />
          </div>
          <Button onClick={saveDeadlineSettings}>保存</Button>
        </CardContent>
      </Card>
    </div>
  )
}
