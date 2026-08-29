'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  DEFAULT_FORMULA_MULTIPLIER, parsePlatformSettings,
  type PlatformKey, type PlatformSettings,
} from '@/lib/platform-earnings'

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

// 他のテーマ(rose/emerald/midnight/gold/violet)の配色定義自体はglobals.css/app-nav.tsxに残したまま、
// 選択肢としてはいったんMonoのみに絞っている（今後ここに追加するだけで選べるようになる）
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
]

const PLATFORM_LABEL: Record<PlatformKey, string> = {
  stripchat: 'STRIPCHAT（TK）', fc2: 'FC2（ポイント）', dxlive: 'DXライブ（ポイント）',
}
const PLATFORM_UNIT: Record<PlatformKey, string> = {
  stripchat: 'TK', fc2: 'ポイント', dxlive: 'ポイント',
}
/** formula_multiplier の結果が USD 建てか JPY 建てか（FC2はドルを経由せず直接円） */
const PLATFORM_FORMULA_CURRENCY: Record<PlatformKey, 'usd' | 'jpy'> = {
  stripchat: 'usd', fc2: 'jpy', dxlive: 'usd',
}

interface Props {
  store: { id: string; name: string } | null
  settings: {
    id: string
    deadline_type: string
    deadline_day: number
    location_mode: string
    area_label: string
    room_label: string
    theme: string
    logo_url: string | null
    usd_jpy_rate: number | null
    usd_jpy_auto_fetch: boolean
    usd_jpy_adjustment: number
    platform_settings: unknown
    notice_show_sales_total: boolean
    notice_show_reward_rate: boolean
  } | null
  storeId: string
}

export function StoreSettings({ store: initialStore, settings: initialSettings, storeId }: Props) {
  const [storeName, setStoreName] = useState(initialStore?.name ?? '')
  const [deadlineType, setDeadlineType] = useState(initialSettings?.deadline_type ?? 'monthly')
  const [deadlineDay, setDeadlineDay] = useState(String(initialSettings?.deadline_day ?? 25))
  const [locationMode, setLocationMode] = useState(initialSettings?.location_mode ?? 'room')
  const [areaLabel, setAreaLabel] = useState(initialSettings?.area_label ?? 'エリア')
  const [roomLabel, setRoomLabel] = useState(initialSettings?.room_label ?? 'ルーム')
  const [theme, setTheme] = useState(initialSettings?.theme ?? 'default')
  const [logoUrl, setLogoUrl] = useState(initialSettings?.logo_url ?? null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [usdJpyRate, setUsdJpyRate] = useState(String(initialSettings?.usd_jpy_rate ?? ''))
  const [fetchingRate, setFetchingRate] = useState(false)
  const [usdJpyAutoFetch, setUsdJpyAutoFetch] = useState(initialSettings?.usd_jpy_auto_fetch ?? true)
  const [usdJpyAdjustment, setUsdJpyAdjustment] = useState(String(initialSettings?.usd_jpy_adjustment ?? 0))
  const [liveRate, setLiveRate] = useState<number | null>(null)
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings>(parsePlatformSettings(initialSettings?.platform_settings))
  const [noticeShowSalesTotal, setNoticeShowSalesTotal] = useState(initialSettings?.notice_show_sales_total ?? true)
  const [noticeShowRewardRate, setNoticeShowRewardRate] = useState(initialSettings?.notice_show_reward_rate ?? true)
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    if (!usdJpyAutoFetch) return
    fetch('https://api.frankfurter.dev/v1/latest?from=USD&to=JPY')
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(data => { if (typeof data?.rates?.JPY === 'number') setLiveRate(data.rates.JPY) })
      .catch(() => {})
  }, [usdJpyAutoFetch])

  async function fetchLatestRate() {
    setFetchingRate(true)
    try {
      const res = await fetch('https://api.frankfurter.dev/v1/latest?from=USD&to=JPY')
      if (!res.ok) throw new Error('fetch failed')
      const data = await res.json()
      const rate = data?.rates?.JPY
      if (typeof rate !== 'number') throw new Error('no rate')
      setUsdJpyRate(rate.toFixed(2))
      toast.success(`最新レートを取得しました（¥${rate.toFixed(2)}）`)
    } catch {
      toast.error('レートの自動取得に失敗しました。手入力してください')
    } finally {
      setFetchingRate(false)
    }
  }

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
    const payload = {
      location_mode: locationMode, area_label: areaLabel, room_label: roomLabel,
    }
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
      const { error } = await supabase.from('store_settings').update({ theme }).eq('id', initialSettings.id)
      if (error) { toast.error('保存に失敗しました'); return }
    } else {
      const { error } = await supabase.from('store_settings').insert({ theme, store_id: storeId })
      if (error) { toast.error('保存に失敗しました'); return }
    }
    toast.success('テーマを変更しました')
    router.refresh()
  }

  async function uploadLogo(file: File) {
    setUploadingLogo(true)
    try {
      const ext = file.name.split('.').pop() ?? 'png'
      const path = `${storeId}/logo.${ext}`
      const { error: uploadError } = await supabase.storage.from('store-assets').upload(path, file, { upsert: true })
      if (uploadError) { toast.error('アップロードに失敗しました'); return }
      const { data } = supabase.storage.from('store-assets').getPublicUrl(path)
      const publicUrl = `${data.publicUrl}?t=${Date.now()}`
      const payload = { logo_url: publicUrl }
      if (initialSettings) {
        const { error } = await supabase.from('store_settings').update(payload).eq('id', initialSettings.id)
        if (error) { toast.error('保存に失敗しました'); return }
      } else {
        const { error } = await supabase.from('store_settings').insert({ ...payload, store_id: storeId })
        if (error) { toast.error('保存に失敗しました'); return }
      }
      setLogoUrl(publicUrl)
      toast.success('ロゴを更新しました')
    } finally {
      setUploadingLogo(false)
    }
  }

  async function savePlatformSettings() {
    const payload = {
      usd_jpy_rate: usdJpyRate ? parseFloat(usdJpyRate) : null,
      usd_jpy_auto_fetch: usdJpyAutoFetch,
      usd_jpy_adjustment: usdJpyAdjustment ? parseFloat(usdJpyAdjustment) : 0,
      platform_settings: platformSettings,
    }
    if (initialSettings) {
      const { error } = await supabase.from('store_settings').update(payload).eq('id', initialSettings.id)
      if (error) { toast.error('保存に失敗しました'); return }
    } else {
      const { error } = await supabase.from('store_settings').insert({ ...payload, store_id: storeId })
      if (error) { toast.error('保存に失敗しました'); return }
    }
    toast.success('プラットフォーム設定を保存しました')
  }

  async function saveNoticeSettings() {
    const payload = {
      notice_show_sales_total: noticeShowSalesTotal,
      notice_show_reward_rate: noticeShowRewardRate,
    }
    if (initialSettings) {
      const { error } = await supabase.from('store_settings').update(payload).eq('id', initialSettings.id)
      if (error) { toast.error('保存に失敗しました'); return }
    } else {
      const { error } = await supabase.from('store_settings').insert({ ...payload, store_id: storeId })
      if (error) { toast.error('保存に失敗しました'); return }
    }
    toast.success('支払通知書設定を保存しました')
  }

  async function saveDeadlineSettings() {
    const payload = {
      store_id: storeId,
      deadline_type: deadlineType as 'monthly' | 'weekly' | 'none',
      deadline_day: parseInt(deadlineDay),
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
    <div className="space-y-6">
      <Card>
        <CardHeader><CardTitle>店舗情報</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>店舗名</Label>
            <Input value={storeName} onChange={e => setStoreName(e.target.value)} />
          </div>
          <Button onClick={saveStoreName}>保存</Button>
          <div className="space-y-1.5 pt-2 border-t">
            <Label>店舗ロゴ</Label>
            <p className="text-xs text-muted-foreground">支払通知書などの印刷用ドキュメントに表示されます</p>
            {logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="店舗ロゴ" className="h-12 w-auto object-contain border rounded bg-white p-1" />
            )}
            <Input
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              disabled={uploadingLogo}
              onChange={e => { const file = e.target.files?.[0]; if (file) uploadLogo(file) }}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>デザインテーマ</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {THEMES.map(t => (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`w-40 shrink-0 rounded-xl overflow-hidden text-left transition-all ring-2 ${
                  theme === t.id
                    ? 'ring-white shadow-lg shadow-black/30 scale-[1.02]'
                    : 'ring-transparent hover:ring-white/40'
                }`}
              >
                {/* プレビュー */}
                <div className="flex h-20">
                  {/* サイドバー */}
                  <div
                    className="w-10 shrink-0 flex flex-col gap-1.5 p-2"
                    style={{ backgroundColor: t.sidebar, borderRight: `1px solid ${t.sidebarBorder}` }}
                  >
                    {[0, 1, 2].map(i => (
                      <div
                        key={i}
                        className="h-2 rounded-full"
                        style={{ backgroundColor: i === 0 ? t.accent : `${t.accent}44`, width: i === 0 ? '100%' : '70%' }}
                      />
                    ))}
                  </div>
                  {/* コンテンツ */}
                  <div className="flex-1 p-2 flex flex-col gap-1.5" style={{ backgroundColor: t.mainBg }}>
                    <div className="h-2.5 w-3/4 rounded-full" style={{ backgroundColor: t.dark ? 'rgba(255,255,255,0.15)' : '#e5e7eb' }} />
                    <div className="h-5 w-1/2 rounded" style={{ backgroundColor: t.accent }} />
                    <div className="h-2.5 w-2/3 rounded-full" style={{ backgroundColor: t.dark ? 'rgba(255,255,255,0.08)' : '#f3f4f6' }} />
                  </div>
                </div>
                <div className="px-3 py-2 bg-white">
                  <p className="text-sm font-bold">{t.label}</p>
                  <p className="text-xs text-gray-500">{t.desc}</p>
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
            <>
              <div className="space-y-1.5">
                <Label>ルームの呼び名</Label>
                <Input value={roomLabel} onChange={e => setRoomLabel(e.target.value)} placeholder="例: ルーム、席、テーブル" />
              </div>
              <p className="text-xs text-muted-foreground pt-2 border-t">
                同じ時間帯・同じ{roomLabel}への複数シフト確定は、{roomLabel}ごとの収容人数で判定されます（{roomLabel}管理で設定。収容人数未設定の{roomLabel}は人数無制限。空き枠の承認は、この設定に関わらず重複できません）
              </p>
            </>
          )}
          <Button onClick={saveLocationSettings}>保存</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>締切ルール</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>締切タイプ</Label>
            <Select value={deadlineType} onValueChange={v => {
              if (!v) return
              setDeadlineType(v)
              if (v === 'monthly' && Number(deadlineDay) > 31) setDeadlineDay('25')
              if (v === 'weekly' && Number(deadlineDay) > 6) setDeadlineDay('5')
            }}>
              <SelectTrigger>
                <SelectValue>
                  {{ monthly: '月次（毎月X日）', weekly: '週次（毎週X曜日）', none: '締切なし' }[deadlineType] ?? deadlineType}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">締切なし</SelectItem>
                <SelectItem value="monthly">月次（毎月X日）</SelectItem>
                <SelectItem value="weekly">週次（毎週X曜日）</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {deadlineType !== 'none' && (
            <div className="space-y-1.5">
              <Label>締切{deadlineType === 'monthly' ? '日' : '曜日'}</Label>
              {deadlineType === 'monthly' ? (
                <Select value={deadlineDay} onValueChange={v => { if (v) setDeadlineDay(v) }}>
                  <SelectTrigger><SelectValue>{`毎月${deadlineDay}日`}</SelectValue></SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
                      <SelectItem key={d} value={String(d)}>{d}日</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Select value={deadlineDay} onValueChange={v => { if (v) setDeadlineDay(v) }}>
                  <SelectTrigger><SelectValue>{WEEKDAY_LABELS[Number(deadlineDay)]}曜日</SelectValue></SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    {WEEKDAY_LABELS.map((label, i) => (
                      <SelectItem key={i} value={String(i)}>{label}曜日</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <p className="text-xs text-muted-foreground">
                {deadlineType === 'monthly'
                  ? `毎月${deadlineDay}日まではその月の翌月分のシフトのみ、${deadlineDay}日を過ぎたら翌々月分のシフトのみ新規提出できます`
                  : `毎週${WEEKDAY_LABELS[Number(deadlineDay)]}曜日の翌日からの7日間のみ新規提出でき、${WEEKDAY_LABELS[Number(deadlineDay)]}曜日を過ぎたら次の${WEEKDAY_LABELS[Number(deadlineDay)]}曜日の翌日からの7日間のみ新規提出できます`}
              </p>
            </div>
          )}
          <Button onClick={saveDeadlineSettings}>保存</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>プラットフォーム連携・為替設定</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label>為替レートを自動取得する</Label>
              <Switch checked={usdJpyAutoFetch} onCheckedChange={setUsdJpyAutoFetch} />
            </div>
            <p className="text-xs text-muted-foreground">
              オンにすると、売上入力のたびに実勢レートを自動取得し、下の調整額を加えた値をその場で使用します（手動での更新は不要になります）。オフにすると、下の「USD → JPY 参考レート」を手動で管理する従来の方式に戻ります
            </p>
          </div>

          {usdJpyAutoFetch ? (
            <div className="space-y-1.5">
              <Label>為替調整（円）</Label>
              <Input
                type="number" step="0.01" placeholder="例: 2（マイナスも可）"
                value={usdJpyAdjustment} onChange={e => setUsdJpyAdjustment(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {liveRate != null
                  ? `現在の実勢レート ¥${liveRate.toFixed(2)} ＋ 調整額 ＝ ¥${(liveRate + (parseFloat(usdJpyAdjustment) || 0)).toFixed(2)}（売上入力で使用される値）`
                  : '実勢レートを取得中...'}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label>USD → JPY 参考レート</Label>
              <div className="flex gap-2">
                <Input
                  type="number" step="0.01" min="0" placeholder="例: 150.25"
                  value={usdJpyRate} onChange={e => setUsdJpyRate(e.target.value)}
                />
                <Button type="button" variant="outline" onClick={fetchLatestRate} disabled={fetchingRate} className="shrink-0">
                  {fetchingRate ? '取得中...' : '自動取得'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                「自動取得」で当日の参考レートを取得できます（手入力での上書きも可能）。STRIPCHAT・DXライブの売上入力時、この時点のレートがスナップショットとして記録されます
              </p>
            </div>
          )}

          {(Object.keys(PLATFORM_LABEL) as PlatformKey[]).map(key => (
            <div key={key} className="space-y-1.5 pt-3 border-t first:border-t-0 first:pt-0">
              <Label>{PLATFORM_LABEL[key]}</Label>
              <Select
                value={platformSettings[key].mode}
                onValueChange={v => { if (v) setPlatformSettings({ ...platformSettings, [key]: { ...platformSettings[key], mode: v as 'formula' | 'fixed' } }) }}
              >
                <SelectTrigger>
                  <SelectValue>{platformSettings[key].mode === 'formula' ? '計算式を使う' : '固定単価を使う'}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="formula">計算式を使う</SelectItem>
                  <SelectItem value="fixed">固定単価を使う</SelectItem>
                </SelectContent>
              </Select>
              {platformSettings[key].mode === 'formula' ? (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-normal">
                    掛け率（1{PLATFORM_UNIT[key]} = ◯{PLATFORM_FORMULA_CURRENCY[key] === 'usd' ? 'ドル' : '円'}）
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number" step="0.0001" min="0"
                      placeholder={String(DEFAULT_FORMULA_MULTIPLIER[key])}
                      value={platformSettings[key].formula_multiplier ?? ''}
                      onChange={e => setPlatformSettings({
                        ...platformSettings,
                        [key]: { ...platformSettings[key], formula_multiplier: e.target.value ? parseFloat(e.target.value) : null },
                      })}
                    />
                    {platformSettings[key].formula_multiplier != null && (
                      <Button
                        type="button" variant="outline" size="sm"
                        onClick={() => setPlatformSettings({
                          ...platformSettings,
                          [key]: { ...platformSettings[key], formula_multiplier: null },
                        })}
                      >
                        既定値に戻す
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    既定: 1{PLATFORM_UNIT[key]} = {DEFAULT_FORMULA_MULTIPLIER[key]}
                    {PLATFORM_FORMULA_CURRENCY[key] === 'usd' ? 'ドル（為替レートで円換算）' : '円'}
                    。プラットフォーム側の換算率が変わった場合はここを書き換えてください。
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-normal">1{PLATFORM_UNIT[key]} = ◯円</Label>
                  <Input
                    type="number" step="0.01" min="0" placeholder="例: 5"
                    value={platformSettings[key].fixed_rate ?? ''}
                    onChange={e => setPlatformSettings({
                      ...platformSettings,
                      [key]: { ...platformSettings[key], fixed_rate: e.target.value ? parseFloat(e.target.value) : null },
                    })}
                  />
                </div>
              )}
            </div>
          ))}
          <Button onClick={savePlatformSettings}>保存</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>支払通知書設定</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">売上合計を通知書に載せる</p>
              <p className="text-xs text-muted-foreground">OFFにすると新しく発行する通知書に売上合計の項目が表示されなくなります</p>
            </div>
            <Switch checked={noticeShowSalesTotal} onCheckedChange={setNoticeShowSalesTotal} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">報酬率を通知書に載せる</p>
              <p className="text-xs text-muted-foreground">OFFにすると新しく発行する通知書に報酬率の項目が表示されなくなります</p>
            </div>
            <Switch checked={noticeShowRewardRate} onCheckedChange={setNoticeShowRewardRate} />
          </div>
          <p className="text-xs text-muted-foreground">
            この設定は今後発行する通知書に適用されます。発行済みの通知書は「発行済み支払通知書」の編集から個別に変更できます。
          </p>
          <Button onClick={saveNoticeSettings}>保存</Button>
        </CardContent>
      </Card>
    </div>
  )
}
