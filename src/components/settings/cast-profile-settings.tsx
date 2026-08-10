'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'

interface Props {
  userId: string
  email: string
  initialDisplayName: string | null
  initialPhotoUrl: string | null
  initialBirthdate: string | null
  initialShowBirthdate: boolean
}

export function CastProfileSettings({
  userId, email, initialDisplayName, initialPhotoUrl, initialBirthdate, initialShowBirthdate,
}: Props) {
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [photoUrl, setPhotoUrl] = useState(initialPhotoUrl)
  const [birthdate, setBirthdate] = useState(initialBirthdate ?? '')
  const [showBirthdate, setShowBirthdate] = useState(initialShowBirthdate)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const supabase = createClient()

  async function uploadPhoto(file: File) {
    setUploadingPhoto(true)
    try {
      const ext = file.name.split('.').pop() ?? 'jpg'
      const path = `${userId}/avatar.${ext}`
      const { error: uploadError } = await supabase.storage.from('cast-avatars').upload(path, file, { upsert: true })
      if (uploadError) { toast.error('アップロードに失敗しました'); return }
      const { data } = supabase.storage.from('cast-avatars').getPublicUrl(path)
      const publicUrl = `${data.publicUrl}?t=${Date.now()}`
      const { error } = await supabase.from('users').update({ photo_url: publicUrl }).eq('id', userId)
      if (error) { toast.error('保存に失敗しました'); return }
      setPhotoUrl(publicUrl)
      toast.success('写真を更新しました')
    } finally {
      setUploadingPhoto(false)
    }
  }

  async function save() {
    setSaving(true)
    try {
      const { error } = await supabase.from('users').update({
        display_name: displayName || null,
        birthdate: birthdate || null,
        show_birthdate: showBirthdate,
      }).eq('id', userId)
      if (error) { toast.error('保存に失敗しました'); return }
      toast.success('プロフィールを更新しました')
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card elevated>
      <CardHeader>
        <CardTitle>プロフィール編集</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col items-center gap-1.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingPhoto}
            className="relative h-20 w-20 rounded-full overflow-hidden bg-muted disabled:opacity-70"
          >
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-2xl font-bold text-muted-foreground">
                {(displayName || email).slice(0, 1)}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingPhoto}
            className="text-xs font-medium"
            style={{ color: 'var(--brand-accent)' }}
          >
            {uploadingPhoto ? 'アップロード中...' : '編集'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={e => { const file = e.target.files?.[0]; if (file) uploadPhoto(file) }}
          />
        </div>

        <div className="space-y-1.5">
          <Label>名前</Label>
          <Input value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="表示名を入力" />
        </div>

        <div className="space-y-1.5">
          <Label>メールアドレス</Label>
          <Input value={email} disabled />
          <p className="text-xs text-muted-foreground">メールアドレスの変更は管理者にご連絡ください</p>
        </div>

        <div className="space-y-1.5">
          <Label>生年月日</Label>
          <Input type="date" value={birthdate} onChange={e => setBirthdate(e.target.value)} />
        </div>

        <div className="flex items-center justify-between">
          <Label>誕生日を表示</Label>
          <Switch
            checked={showBirthdate}
            onCheckedChange={setShowBirthdate}
            className="data-checked:bg-[var(--brand-accent)]"
          />
        </div>

        <Button variant="elevated" className="w-full" onClick={save} disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </Button>
      </CardContent>
    </Card>
  )
}
