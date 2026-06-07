'use client'

import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Plus, Pencil, Trash2 } from 'lucide-react'

interface Sale {
  id: string; cast_id: string; date: string; amount: number | string; notes: string | null
  cast: { display_name: string | null } | null
}

interface Props {
  casts: { id: string; display_name: string | null }[]
  sales: Sale[]
  storeId: string
  userId: string
}

export function SalesInput({ casts, sales: initialSales, storeId, userId }: Props) {
  const [sales, setSales] = useState(initialSales)
  const [form, setForm] = useState({ cast_id: '', date: format(new Date(), 'yyyy-MM-dd'), amount: '', notes: '' })
  const [editing, setEditing] = useState<Sale | null>(null)
  const supabase = createClient()

  const monthlyTotal = useMemo(() => {
    const month = format(new Date(), 'yyyy-MM')
    return sales.filter(s => s.date.startsWith(month)).reduce((sum, s) => sum + Number(s.amount), 0)
  }, [sales])

  async function handleSave() {
    if (!form.cast_id || !form.amount) { toast.error('キャストと金額は必須です'); return }
    const payload = { cast_id: form.cast_id, date: form.date, amount: parseInt(form.amount), notes: form.notes || null, store_id: storeId, created_by: userId }

    if (editing) {
      const { error } = await supabase.from('sales').update(payload).eq('id', editing.id)
      if (error) { toast.error('更新に失敗しました'); return }
      const cast = casts.find(c => c.id === form.cast_id)
      setSales(sales.map(s => s.id === editing.id ? { ...s, ...payload, cast: cast ? { display_name: cast.display_name } : null } : s))
      setEditing(null)
      toast.success('売上を更新しました')
    } else {
      const { data, error } = await supabase.from('sales').insert(payload).select('*, cast:users!sales_cast_id_fkey(display_name)').single()
      if (error) { toast.error('登録に失敗しました'); return }
      setSales([data, ...sales])
      toast.success('売上を登録しました')
    }
    setForm({ cast_id: '', date: format(new Date(), 'yyyy-MM-dd'), amount: '', notes: '' })
  }

  async function handleDelete(id: string) {
    if (!confirm('削除しますか？')) return
    const { error } = await supabase.from('sales').delete().eq('id', id)
    if (error) { toast.error('削除に失敗しました'); return }
    setSales(sales.filter(s => s.id !== id))
    toast.success('削除しました')
  }

  function startEdit(sale: Sale) {
    setEditing(sale)
    setForm({ cast_id: sale.cast_id, date: sale.date, amount: String(sale.amount), notes: sale.notes ?? '' })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>売上入力</CardTitle>
          <p className="text-sm text-muted-foreground">今月合計: ¥{monthlyTotal.toLocaleString()}</p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label>キャスト *</Label>
              <Select value={form.cast_id} onValueChange={v => { if (v) setForm({ ...form, cast_id: v }) }}>
                <SelectTrigger><SelectValue placeholder="選択" /></SelectTrigger>
                <SelectContent>
                  {casts.map(c => <SelectItem key={c.id} value={c.id}>{c.display_name ?? c.id}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>日付 *</Label>
              <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>売上金額（円）*</Label>
              <Input type="number" min="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0" />
            </div>
            <div className="space-y-1.5">
              <Label>備考</Label>
              <Input value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <Button onClick={handleSave}><Plus className="h-4 w-4 mr-1" />{editing ? '更新' : '登録'}</Button>
            {editing && <Button variant="outline" onClick={() => { setEditing(null); setForm({ cast_id: '', date: format(new Date(), 'yyyy-MM-dd'), amount: '', notes: '' }) }}>キャンセル</Button>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>売上一覧</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日付</TableHead>
                <TableHead>キャスト</TableHead>
                <TableHead className="text-right">金額</TableHead>
                <TableHead>備考</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sales.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-8">売上データがありません</TableCell></TableRow>
              )}
              {sales.map(sale => (
                <TableRow key={sale.id}>
                  <TableCell>{format(new Date(sale.date), 'M/d(E)', { locale: ja })}</TableCell>
                  <TableCell>{sale.cast?.display_name ?? '—'}</TableCell>
                  <TableCell className="text-right">¥{Number(sale.amount).toLocaleString()}</TableCell>
                  <TableCell>{sale.notes ?? '—'}</TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button size="icon" variant="ghost" onClick={() => startEdit(sale)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => handleDelete(sale.id)}><Trash2 className="h-3.5 w-3.5 text-red-500" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
