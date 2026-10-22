'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChevronDown, ChevronUp } from 'lucide-react'
import {
  parseNoticeItemConfig, DEFAULT_NOTICE_FOOTER_TEXT, type NoticeItemConfigEntry,
} from '@/lib/notice-template'
import type { Json } from '@/lib/supabase/database.types'

interface Props {
  settingsId: string | null
  storeId: string
  itemConfig: unknown
  headerText: string | null
  footerText: string | null
  fxVisible: boolean
}

export function NoticeTemplateSettings({ settingsId, storeId, itemConfig, headerText, footerText, fxVisible: initialFxVisible }: Props) {
  const [items, setItems] = useState<NoticeItemConfigEntry[]>(parseNoticeItemConfig(itemConfig))
  const [header, setHeader] = useState(headerText ?? '')
  const [footer, setFooter] = useState(footerText ?? '')
  const [fxVisible, setFxVisible] = useState(initialFxVisible)
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  function move(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= items.length) return
    const next = [...items]
    ;[next[index], next[target]] = [next[target], next[index]]
    setItems(next)
  }

  function updateLabel(index: number, label: string) {
    setItems(items.map((it, i) => i === index ? { ...it, label } : it))
  }

  function toggleVisible(index: number) {
    setItems(items.map((it, i) => i === index ? { ...it, visible: !it.visible } : it))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const payload = {
        notice_item_config: items as unknown as Json, notice_header_text: header.trim() || null, notice_footer_text: footer.trim() || null,
        notice_fx_visible: fxVisible,
      }
      if (settingsId) {
        const { error } = await supabase.from('store_settings').update(payload).eq('id', settingsId)
        if (error) { toast.error('保存に失敗しました'); return }
      } else {
        const { error } = await supabase.from('store_settings').insert({ ...payload, store_id: storeId })
        if (error) { toast.error('保存に失敗しました'); return }
      }
      toast.success('通知書テンプレートを保存しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>支払通知書テンプレート設定</CardTitle>
        <p className="text-xs text-muted-foreground pt-1">
          項目の並び順・表示ON/OFF・名称と、ヘッダー/フッターの文言をカスタマイズできます。
          この設定は今後発行する通知書に適用されます。発行済みの通知書は「発行済み支払通知書」の編集から個別に変更できます。
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-1.5">
          <Label>表示項目（並び替え・表示ON/OFF・名称変更）</Label>
          <div className="space-y-2">
            {items.map((entry, i) => (
              <div key={entry.key} className="flex items-center gap-2 p-2 rounded-md border">
                <div className="flex flex-col">
                  <Button
                    type="button" size="icon" variant="ghost" className="h-5 w-5"
                    disabled={i === 0} onClick={() => move(i, -1)}
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button" size="icon" variant="ghost" className="h-5 w-5"
                    disabled={i === items.length - 1} onClick={() => move(i, 1)}
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <Checkbox checked={entry.visible} onCheckedChange={() => toggleVisible(i)} />
                {entry.key === 'custom_items' ? (
                  <p className="text-sm text-muted-foreground flex-1">
                    追加項目（ボーナス・ドリンクバックなど、通知書の項目設定で登録したもの）
                  </p>
                ) : (
                  <Input
                    className="flex-1" value={entry.label}
                    onChange={e => updateLabel(i, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            「合計お支払額」は常に最後に表示され、非表示・並び替えはできません。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox checked={fxVisible} onCheckedChange={() => setFxVisible(v => !v)} id="notice-fx-visible" />
          <Label htmlFor="notice-fx-visible" className="font-normal cursor-pointer">
            支払通知書に為替レート・USD金額を表示する
          </Label>
        </div>
        <p className="text-xs text-muted-foreground -mt-4">
          支払通知書の画面・PDFにのみ適用されます。売上入力・売上一覧の表示や金額計算には影響しません。設定変更は今後発行する通知書に適用され、発行済みの通知書は変わりません。為替データがない場合は、ONでも表示されません。
        </p>

        <div className="space-y-1.5">
          <Label>ヘッダーの追加メッセージ（任意）</Label>
          <Textarea
            value={header} onChange={e => setHeader(e.target.value)} rows={2}
            placeholder="キャスト名・お支払い明細の案内文の下に表示されます"
          />
        </div>

        <div className="space-y-1.5">
          <Label>フッターの文言（任意）</Label>
          <Textarea
            value={footer} onChange={e => setFooter(e.target.value)} rows={3}
            placeholder={DEFAULT_NOTICE_FOOTER_TEXT}
          />
          <p className="text-xs text-muted-foreground">空欄の場合は既定の文言が使われます</p>
        </div>

        <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
      </CardContent>
    </Card>
  )
}
