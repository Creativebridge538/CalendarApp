'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Check } from 'lucide-react'
import { ACCENT_SKINS, DEFAULT_ACCENT_SKIN } from '@/lib/accent-skins'

export function CastAppearanceSettings({ userId, initialSkin }: { userId: string; initialSkin: string | null }) {
  const [skin, setSkin] = useState(initialSkin ?? DEFAULT_ACCENT_SKIN)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const supabase = createClient()

  function selectSkin(id: string) {
    if (id === skin) return
    const previous = skin
    setSkin(id)
    startTransition(async () => {
      const { error } = await supabase.from('users').update({ accent_skin: id }).eq('id', userId)
      if (error) {
        setSkin(previous)
        toast.error('保存に失敗しました')
        return
      }
      toast.success('着せ替えを変更しました')
      router.refresh()
    })
  }

  return (
    <Card elevated>
      <CardHeader>
        <CardTitle>着せ替え</CardTitle>
        <p className="text-sm text-muted-foreground">シフト画面や報酬明細の配色を選べます</p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3">
          {ACCENT_SKINS.map(s => {
            const isActive = skin === s.id
            return (
              <button
                key={s.id}
                onClick={() => selectSkin(s.id)}
                disabled={isPending}
                className={`rounded-xl overflow-hidden text-left transition-all ring-2 disabled:opacity-70 ${
                  isActive ? 'ring-foreground shadow-lg scale-[1.02]' : 'ring-transparent hover:ring-foreground/20'
                }`}
              >
                <div className="relative h-16" style={{ backgroundColor: s.bg }}>
                  <div className="h-6" style={{ backgroundColor: s.accent }} />
                  <span
                    className="absolute bottom-2 right-2 h-6 w-6 rounded-full border-2 border-white flex items-center justify-center"
                    style={{ backgroundColor: s.accent }}
                  >
                    {isActive && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                  </span>
                </div>
                <div className="px-2 py-1.5 bg-card">
                  <p className="text-xs font-bold">{s.label}</p>
                </div>
              </button>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
