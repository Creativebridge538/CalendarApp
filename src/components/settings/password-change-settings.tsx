'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

export function PasswordChangeSettings() {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  async function handleSave() {
    if (password.length < 8) {
      toast.error('パスワードは8文字以上で入力してください')
      return
    }
    if (password !== confirmPassword) {
      toast.error('パスワードが一致しません')
      return
    }
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (error) { toast.error('パスワードの変更に失敗しました'); return }
    setPassword('')
    setConfirmPassword('')
    toast.success('パスワードを変更しました')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>パスワード変更</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label>新しいパスワード</Label>
          <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="8文字以上" autoComplete="new-password" />
        </div>
        <div className="space-y-1.5">
          <Label>確認用</Label>
          <Input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} autoComplete="new-password" />
        </div>
        <Button onClick={handleSave} disabled={saving || !password}>
          {saving ? '変更中...' : '変更する'}
        </Button>
      </CardContent>
    </Card>
  )
}
