'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

interface Props {
  userId: string
  initialLoginId: string
}

export function LoginIdSettings({ userId, initialLoginId }: Props) {
  const [loginId, setLoginId] = useState(initialLoginId)
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  async function handleSave() {
    const trimmed = loginId.trim()
    if (!trimmed) {
      toast.error('ユーザーIDを入力してください')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('users').update({ login_id: trimmed }).eq('id', userId)
    setSaving(false)
    if (error) {
      toast.error(error.code === '23505' ? 'このユーザーIDは既に使用されています' : '更新に失敗しました')
      return
    }
    setLoginId(trimmed)
    toast.success('ユーザーIDを変更しました')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>ユーザーID</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>ログインに使用するユーザーID</Label>
          <Input value={loginId} onChange={e => setLoginId(e.target.value)} />
        </div>
        <Button onClick={handleSave} disabled={saving || !loginId.trim() || loginId.trim() === initialLoginId}>
          {saving ? '変更中...' : '変更する'}
        </Button>
      </CardContent>
    </Card>
  )
}
