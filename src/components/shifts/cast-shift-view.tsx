'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { shiftConflictMessage } from '@/lib/shift-conflict'
import { toast } from 'sonner'
import { format, isAfter, addMonths, subMonths, addDays, subDays, startOfWeek, isSameDay } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TimeSelect, normalizeTime } from '@/components/ui/time-select'
import { Plus, Pencil, FileEdit, CalendarDays, CalendarRange, CalendarClock, CalendarPlus, List, Trash2, ChevronLeft, ChevronRight, MapPin, StickyNote, Menu, X, Check, Search, Bell, LogOut, Smartphone, AlertTriangle } from 'lucide-react'
import type { Database } from '@/lib/supabase/database.types'
import { sendPushNotification } from '@/lib/push'
import { ShiftCalendar } from './shift-calendar'
import { MonthYearPicker } from './month-year-picker'
import { Logo } from '@/components/logo'
import { GoalRing } from '@/components/rewards/goal-ring'
import type { MonthToDateSummary } from '@/lib/reward-summary'
import { cn } from '@/lib/utils'

type ShiftStatus = Database['public']['Enums']['shift_status']

type ChecklistAnswers = Record<string, boolean | string>

interface Shift {
  id: string; date: string; start_time: string; end_time: string
  status: ShiftStatus; notes: string | null
  admin_note: string | null
  is_period_day: boolean
  checklist_answers: ChecklistAnswers
  room_id: string | null
  area_id: string | null
  rooms: { name: string } | null
  areas: { name: string } | null
}

interface Settings {
  deadline_type: string; deadline_day: number; deadline_week_start_day: number; require_approval_after_deadline: boolean
  location_mode: string; area_label: string; room_label: string
}

const STATUS_LABEL: Record<ShiftStatus, string> = {
  draft: '下書き', submitted: '提出済み', confirmed: '確定', rejected: '差し戻し', modification_requested: '修正依頼中',
}
const STATUS_VARIANT: Record<ShiftStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft: 'outline', submitted: 'secondary', confirmed: 'default', rejected: 'destructive', modification_requested: 'secondary',
}
const STATUS_DOT: Record<ShiftStatus, string> = {
  draft: 'var(--status-draft)', submitted: 'var(--status-submitted)',
  confirmed: 'var(--status-confirmed)', rejected: 'var(--status-rejected)',
  modification_requested: 'var(--status-modification-requested)',
}

interface Props {
  shifts: Shift[]
  rooms: { id: string; name: string; area_id: string | null }[]
  areas: { id: string; name: string }[]
  castId: string
  castName: string | null
  storeId: string
  storeName: string | null
  settings: Settings | null
  userId: string
  checklistItems: { id: string; label: string; item_type: string; options: string[] }[]
  rewardSummary: MonthToDateSummary
  amountByDate: Record<string, number>
  salesByShiftId: Record<string, { amount: number; reward: number }>
}

const HOUR_HEIGHT = 56
const HOURS = Array.from({ length: 24 }, (_, i) => i)

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** 週表示・日表示共通の時間軸グリッド（Googleカレンダー等と同じ、時刻に応じて予定ブロックを配置する形式） */
function ShiftTimeGrid({
  days, shiftsOn, onDayClick, locationLabelOf, onNavigate,
}: {
  days: Date[]
  shiftsOn: (day: Date) => Shift[]
  onDayClick: (day: Date) => void
  locationLabelOf: (shift: Shift) => string | null
  onNavigate?: (direction: 'next' | 'prev') => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const daysKey = days.map(d => d.toISOString()).join(',')

  useEffect(() => {
    const allShifts = days.flatMap(d => shiftsOn(d))
    const earliestMin = allShifts.length > 0
      ? Math.min(...allShifts.map(s => timeToMinutes(s.start_time.slice(0, 5))))
      : 9 * 60
    const scrollHour = Math.max(0, Math.floor(earliestMin / 60) - 1)
    scrollRef.current?.scrollTo({ top: scrollHour * HOUR_HEIGHT })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daysKey])

  // 横方向のスワイプで前後の週・日へ切り替える（縦スクロールと誤認しないよう横方向の移動が優位な場合のみ反応）
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  function handleTouchStart(e: React.TouchEvent) {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  function handleTouchEnd(e: React.TouchEvent) {
    const start = touchStart.current
    touchStart.current = null
    if (!start || !onNavigate) return
    const dx = e.changedTouches[0].clientX - start.x
    const dy = e.changedTouches[0].clientY - start.y
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    onNavigate(dx < 0 ? 'next' : 'prev')
  }

  return (
    <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {/* 日付ヘッダー行。スワイプ判定は下の時間グリッドも含めて全体で受けるが、横方向の移動が縦方向より
          明確に優位な場合のみナビゲーションとみなす（handleTouchEndのdx/dy判定）ため、
          普段の縦スクロール操作を誤ってナビゲーションと認識することはない */}
      <div className="flex border-b border-border/60">
        <div className="w-9 shrink-0" />
        {days.map(day => {
          const isToday = isSameDay(day, new Date())
          return (
            <div key={day.toISOString()} className="flex-1 text-center py-1.5 min-w-0 relative">
              <div className={`text-[10px] ${day.getDay() === 0 ? 'text-red-500' : day.getDay() === 6 ? 'text-blue-500' : 'text-muted-foreground'}`}>
                {format(day, 'E', { locale: ja })}
              </div>
              <span
                className={`inline-flex items-center justify-center h-6 w-6 rounded-full text-sm font-semibold ${isToday ? 'text-white' : ''}`}
                style={isToday ? { backgroundColor: 'var(--brand-accent)' } : undefined}
              >
                {format(day, 'd')}
              </span>
            </div>
          )
        })}
      </div>

      {/* スクロール可能な時間グリッド */}
      <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: 440 }}>
        <div className="flex relative" style={{ height: HOUR_HEIGHT * 24 }}>
          <div className="w-9 shrink-0 relative">
            {HOURS.map(h => (
              <div key={h} className="absolute right-1 text-[10px] text-muted-foreground" style={{ top: h * HOUR_HEIGHT - 6 }}>
                {h}
              </div>
            ))}
          </div>
          {days.map(day => (
            <div
              key={day.toISOString()}
              onClick={() => onDayClick(day)}
              className="flex-1 relative border-l border-border/40 min-w-0 cursor-pointer"
            >
              {HOURS.map(h => (
                <div key={h} className="absolute left-0 right-0 border-t border-border/30" style={{ top: h * HOUR_HEIGHT }} />
              ))}
              {shiftsOn(day).map(s => {
                const startMin = timeToMinutes(s.start_time.slice(0, 5))
                const endMin = timeToMinutes(s.end_time.slice(0, 5))
                const top = (startMin / 60) * HOUR_HEIGHT
                const height = Math.max(20, ((endMin - startMin) / 60) * HOUR_HEIGHT)
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={e => { e.stopPropagation(); onDayClick(day) }}
                    className="absolute left-0.5 right-0.5 rounded-md px-1.5 py-0.5 text-left text-white text-[10px] font-medium overflow-hidden leading-tight break-words"
                    style={{ top, height, backgroundColor: STATUS_DOT[s.status] }}
                    title={`${locationLabelOf(s) ? locationLabelOf(s) + ' ' : ''}${s.start_time.slice(0, 5)}〜${s.end_time.slice(0, 5)} ${STATUS_LABEL[s.status]}`}
                  >
                    {locationLabelOf(s) ?? STATUS_LABEL[s.status]}
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function CastShiftView({ shifts: initialShifts, rooms, areas, castId, castName, storeId, storeName, settings, userId, checklistItems, rewardSummary, amountByDate, salesByShiftId }: Props) {
  const [shifts, setShifts] = useState(initialShifts)
  const [view, setView] = useState<'list' | 'month' | 'week' | 'day'>('month')
  const [calendarMode, setCalendarMode] = useState<'time' | 'amount'>('time')
  const [showPwaBanner, setShowPwaBanner] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [calAnchor, setCalAnchor] = useState(() => new Date())
  const [calDirection, setCalDirection] = useState<'next' | 'prev'>('next')
  const [open, setOpen] = useState(false)
  const [modOpen, setModOpen] = useState(false)
  const [dayDetailDate, setDayDetailDateRaw] = useState<string | null>(null)
  const [detailShiftId, setDetailShiftId] = useState<string | null>(null)
  function setDayDetailDate(date: string | null) {
    setDayDetailDateRaw(date)
    setDetailShiftId(null)
  }
  const [editing, setEditing] = useState<Shift | null>(null)
  const [modTarget, setModTarget] = useState<Shift | null>(null)
  const [cancelTarget, setCancelTarget] = useState<Shift | null>(null)
  const [form, setForm] = useState({ date: '', start_time: '18:00', end_time: '23:00', area_id: '', room_id: '', notes: '', is_period_day: false, checklist_answers: {} as ChecklistAnswers })
  const [modForm, setModForm] = useState({ new_date: '', new_start_time: '', new_end_time: '', reason: '' })
  const [bulkDates, setBulkDates] = useState<Set<string>>(new Set())
  const [bulkTimes, setBulkTimes] = useState<Record<string, { start: string; end: string }>>({})
  const [bulkTemplates, setBulkTemplates] = useState([{ start: '19:00', end: '24:00' }, { start: '20:00', end: '25:00' }])
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false)
  const [newTemplate, setNewTemplate] = useState({ start: '19:00', end: '24:00' })
  const [bulkSheetOpen, setBulkSheetOpen] = useState(false)
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkForm, setBulkForm] = useState({ area_id: '', room_id: '', notes: '', is_period_day: false, checklist_answers: {} as ChecklistAnswers })
  const supabase = createClient()
  const router = useRouter()
  const searchParams = useSearchParams()

  // 下部タブバー中央の「作成」ボタン（/cast/shifts?new=1）から来た場合、まとめて追加フローを自動で開く
  useEffect(() => {
    if (searchParams.get('new') === '1') {
      startBulkAdd()
      router.replace('/cast/shifts', { scroll: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // 管理者側でシフトが確定/差し戻しされた変更を、リロードなしにリアルタイムで反映する
  useEffect(() => {
    const channel = supabase
      .channel(`cast-shifts-${castId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'shifts', filter: `cast_id=eq.${castId}` },
        payload => {
          if (payload.eventType === 'DELETE') {
            const oldRow = payload.old as { id: string }
            setShifts(prev => prev.filter(s => s.id !== oldRow.id))
            return
          }
          const row = payload.new as Database['public']['Tables']['shifts']['Row']
          const room = rooms.find(r => r.id === row.room_id)
          const area = areas.find(a => a.id === row.area_id)
          const joined: Shift = {
            id: row.id, date: row.date, start_time: row.start_time, end_time: row.end_time,
            status: row.status, notes: row.notes, admin_note: row.admin_note,
            is_period_day: row.is_period_day, checklist_answers: (row.checklist_answers ?? {}) as ChecklistAnswers,
            room_id: row.room_id, area_id: row.area_id,
            rooms: room ? { name: room.name } : null,
            areas: area ? { name: area.name } : null,
          }
          setShifts(prev => {
            const existing = prev.find(s => s.id === row.id)
            if (existing && existing.status !== 'confirmed' && row.status === 'confirmed') {
              const dateLabel = format(new Date(`${row.date}T00:00:00`), 'M/d(E)', { locale: ja })
              toast.success(`${dateLabel} ${row.start_time.slice(0, 5)}〜${row.end_time.slice(0, 5)} のシフトが確定しました`)
            }
            if (!existing) return [joined, ...prev]
            return prev.map(s => s.id === row.id ? joined : s)
          })
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [castId])

  // ホーム画面未追加（ブラウザ表示）の場合、PWA化の案内を出す。「次回以降表示しない」はlocalStorageに記録
  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as Navigator & { standalone?: boolean }).standalone === true
    const dismissedForever = localStorage.getItem('pwa-banner-dismissed') === '1'
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window/localStorage はマウント後にしか読めないため
    setShowPwaBanner(!isStandalone && !dismissedForever)
  }, [])

  function dismissPwaBannerForever() {
    localStorage.setItem('pwa-banner-dismissed', '1')
    setShowPwaBanner(false)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }
  const rewardDelta = rewardSummary.prevMonthToDateTotal > 0
    ? ((rewardSummary.thisMonthTotal - rewardSummary.prevMonthToDateTotal) / rewardSummary.prevMonthToDateTotal) * 100
    : null
  const rewardGoalProgress = rewardSummary.monthlyGoal && rewardSummary.monthlyGoal > 0
    ? Math.min(100, (rewardSummary.thisMonthTotal / rewardSummary.monthlyGoal) * 100)
    : null
  const thisMonthKey = format(new Date(), 'yyyy-MM')
  const submittedCountThisMonth = shifts.filter(s => s.date.startsWith(thisMonthKey) && s.status === 'submitted').length
  const confirmedCountThisMonth = shifts.filter(s => s.date.startsWith(thisMonthKey) && s.status === 'confirmed').length
  // 締切を過ぎたら新規シフトの提出をブロックする。
  // monthly: 毎月deadline_day以降は月末までブロック(翌月1日にリセット)。
  // weekly: 週の起点(deadline_week_start_day)からdeadline_day(曜日)以降〜次の起点前日までブロック(次の起点でリセット)。
  const isPastDeadline = (() => {
    if (!settings || settings.deadline_type === 'none') return false
    const now = new Date()
    if (settings.deadline_type === 'monthly') return now.getDate() >= settings.deadline_day
    if (settings.deadline_type === 'weekly') {
      const offsetFromWeekStart = (d: number) => (d - settings.deadline_week_start_day + 7) % 7
      return offsetFromWeekStart(now.getDay()) >= offsetFromWeekStart(settings.deadline_day)
    }
    return false
  })()
  const locationMode = settings?.location_mode ?? 'room'
  const areaLabel = settings?.area_label ?? 'エリア'
  const roomLabel = settings?.room_label ?? 'ルーム'
  const filteredRooms = locationMode === 'area_and_room' && form.area_id
    ? rooms.filter(r => r.area_id === form.area_id)
    : rooms
  const bulkFilteredRooms = locationMode === 'area_and_room' && bulkForm.area_id
    ? rooms.filter(r => r.area_id === bulkForm.area_id)
    : rooms

  function locationLabelOf(shift: Shift): string | null {
    return locationMode === 'area_only' ? (shift.areas?.name ?? null) :
      locationMode === 'room' ? (shift.rooms?.name ?? null) :
      locationMode === 'area_and_room' ? ([shift.areas?.name, shift.rooms?.name].filter(Boolean).join(' / ') || null) :
      null
  }

  function shiftsOn(date: Date) {
    const key = format(date, 'yyyy-MM-dd')
    return shifts.filter(s => s.date === key)
  }

  // 確定済み・修正依頼中のシフトは常に修正申請経由。それ以外は直接編集・取消可能
  function canEditDirectly(shift: Shift): boolean {
    return shift.status !== 'confirmed' && shift.status !== 'modification_requested'
  }

  function canRequestModification(shift: Shift): boolean {
    return shift.status === 'confirmed'
  }

  function openNew(date?: string) {
    setEditing(null)
    setForm({ date: date ?? '', start_time: '18:00', end_time: '23:00', area_id: '', room_id: '', notes: '', is_period_day: false, checklist_answers: {} })
    setOpen(true)
  }

  function openEdit(shift: Shift) {
    setEditing(shift)
    setForm({
      date: shift.date, start_time: shift.start_time.slice(0, 5), end_time: shift.end_time.slice(0, 5),
      area_id: shift.area_id ?? '', room_id: shift.room_id ?? '',
      notes: shift.notes ?? '', is_period_day: shift.is_period_day, checklist_answers: shift.checklist_answers,
    })
    setOpen(true)
  }

  function handleDayClick(date: Date) {
    setDayDetailDate(format(date, 'yyyy-MM-dd'))
  }

  function toggleBulkDate(date: Date) {
    const key = format(date, 'yyyy-MM-dd')
    setBulkDates(prev => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
        setBulkTimes(t => { const nt = { ...t }; delete nt[key]; return nt })
      } else {
        next.add(key)
        setBulkTimes(t => ({ ...t, [key]: t[key] ?? bulkTemplates[0] }))
      }
      return next
    })
  }

  function startBulkAdd() {
    setBulkDates(new Set())
    setBulkTimes({})
    setBulkForm({ area_id: '', room_id: '', notes: '', is_period_day: false, checklist_answers: {} })
    setMenuOpen(false)
    setBulkSheetOpen(true)
  }

  function cancelBulkAdd() {
    setBulkDates(new Set())
    setBulkTimes({})
    setTemplateEditorOpen(false)
    setBulkSheetOpen(false)
  }

  function applyTemplateToAll(t: { start: string; end: string }) {
    setBulkTimes(prev => {
      const next = { ...prev }
      bulkDates.forEach(d => { next[d] = t })
      return next
    })
  }

  function addTemplate() {
    setBulkTemplates(prev => [...prev, newTemplate])
    setTemplateEditorOpen(false)
  }

  function removeTemplate(index: number) {
    setBulkTemplates(prev => prev.filter((_, i) => i !== index))
  }

  function setBulkDateTime(date: string, field: 'start' | 'end', value: string) {
    setBulkTimes(prev => ({ ...prev, [date]: { ...(prev[date] ?? bulkTemplates[0]), [field]: value } }))
  }

  function applyTemplateToDate(date: string, t: { start: string; end: string }) {
    setBulkTimes(prev => ({ ...prev, [date]: t }))
  }

  function goPrev() {
    setCalDirection('prev')
    setCalAnchor(d => view === 'week' ? subDays(d, 7) : view === 'day' ? subDays(d, 1) : subMonths(d, 1))
  }
  function goNext() {
    setCalDirection('next')
    setCalAnchor(d => view === 'week' ? addDays(d, 7) : view === 'day' ? addDays(d, 1) : addMonths(d, 1))
  }

  function checklistBadges(answers: ChecklistAnswers) {
    return Object.entries(answers).map(([id, value]) => {
      const item = checklistItems.find(c => c.id === id)
      if (!item || !value) return null
      return item.item_type === 'select' ? `${item.label}: ${value}` : item.label
    }).filter((v): v is string => !!v)
  }

  function toggleChecklistItem(id: string) {
    setForm(f => {
      const next = { ...f.checklist_answers }
      if (next[id]) delete next[id]
      else next[id] = true
      return { ...f, checklist_answers: next }
    })
  }

  function setChecklistSelect(id: string, value: string) {
    setForm(f => {
      const next = { ...f.checklist_answers }
      if (value) next[id] = value
      else delete next[id]
      return { ...f, checklist_answers: next }
    })
  }

  function toggleBulkChecklistItem(id: string) {
    setBulkForm(f => {
      const next = { ...f.checklist_answers }
      if (next[id]) delete next[id]
      else next[id] = true
      return { ...f, checklist_answers: next }
    })
  }

  function setBulkChecklistSelect(id: string, value: string) {
    setBulkForm(f => {
      const next = { ...f.checklist_answers }
      if (value) next[id] = value
      else delete next[id]
      return { ...f, checklist_answers: next }
    })
  }

  function openModification(shift: Shift) {
    setModTarget(shift)
    setModForm({ new_date: shift.date, new_start_time: shift.start_time.slice(0, 5), new_end_time: shift.end_time.slice(0, 5), reason: '' })
    setModOpen(true)
  }

  async function handleSave() {
    if (!editing && isPastDeadline) { toast.error('シフト提出の締切を過ぎています。管理者にお問い合わせください'); return }
    const payload = {
      cast_id: castId,
      date: form.date,
      start_time: form.start_time,
      end_time: form.end_time,
      area_id: (locationMode === 'area_only' || locationMode === 'area_and_room') ? form.area_id || null : null,
      room_id: (locationMode === 'room' || locationMode === 'area_and_room') ? form.room_id || null : null,
      notes: form.notes || null,
      is_period_day: form.is_period_day,
      checklist_answers: form.checklist_answers,
      status: 'submitted' as ShiftStatus,
    }
    if (editing) {
      const wasRejected = editing.status === 'rejected'
      const { error } = await supabase.from('shifts').update(payload).eq('id', editing.id)
      if (error) { toast.error(shiftConflictMessage(error, '更新に失敗しました')); return }
      setShifts(shifts.map(s => s.id === editing.id ? {
        ...s, ...payload,
        rooms: rooms.find(r => r.id === form.room_id) ?? null,
        areas: areas.find(a => a.id === form.area_id) ?? null,
      } : s))
      toast.success('シフトを更新しました')
      if (wasRejected) {
        const { data: admins } = await supabase.from('users').select('id').eq('store_id', storeId).eq('role', 'admin')
        if (admins?.length) {
          const title = 'シフトが再提出されました'
          const body = `${castName ?? 'キャスト'} ／ ${format(new Date(`${form.date}T00:00:00`), 'M/d(E)', { locale: ja })} ${form.start_time}〜${form.end_time}`
          await supabase.from('notifications').insert(
            admins.map(a => ({ user_id: a.id, title, body, link: '/admin/shifts' }))
          )
          admins.forEach(a => sendPushNotification(a.id, title, body, '/admin/shifts'))
        }
      }
    } else {
      const { data, error } = await supabase.from('shifts').insert({ ...payload, store_id: storeId }).select('*, rooms(name), areas(name)').single()
      if (error) { toast.error(shiftConflictMessage(error, '提出に失敗しました')); return }
      setShifts([{ ...data, checklist_answers: (data.checklist_answers ?? {}) as ChecklistAnswers }, ...shifts])
      toast.success('シフトを提出しました')
    }
    setOpen(false)
  }

  async function handleBulkSave() {
    if (isPastDeadline) { toast.error('シフト提出の締切を過ぎています。管理者にお問い合わせください'); return }
    const dates = Array.from(bulkDates).sort()
    if (dates.length === 0) return
    setBulkSaving(true)
    const payload = dates.map(date => {
      const t = bulkTimes[date] ?? bulkTemplates[0]
      return {
        cast_id: castId,
        store_id: storeId,
        date,
        start_time: normalizeTime(t.start),
        end_time: normalizeTime(t.end),
        area_id: (locationMode === 'area_only' || locationMode === 'area_and_room') ? bulkForm.area_id || null : null,
        room_id: (locationMode === 'room' || locationMode === 'area_and_room') ? bulkForm.room_id || null : null,
        notes: bulkForm.notes || null,
        is_period_day: bulkForm.is_period_day,
        checklist_answers: bulkForm.checklist_answers,
        status: 'submitted' as ShiftStatus,
      }
    })
    const { data, error } = await supabase.from('shifts').insert(payload).select('*, rooms(name), areas(name)')
    setBulkSaving(false)
    if (error) { toast.error(shiftConflictMessage(error, 'まとめての提出に失敗しました')); return }
    setShifts([
      ...(data ?? []).map(d => ({ ...d, checklist_answers: (d.checklist_answers ?? {}) as ChecklistAnswers })),
      ...shifts,
    ])
    toast.success(`${dates.length}件のシフトを提出しました`)
    setBulkSheetOpen(false)
    cancelBulkAdd()
  }

  function handleCancel(shift: Shift) {
    setCancelTarget(shift)
  }

  async function confirmCancel() {
    if (!cancelTarget) return
    const shift = cancelTarget
    const { error } = await supabase.from('shifts').delete().eq('id', shift.id)
    setCancelTarget(null)
    if (error) { toast.error('取消に失敗しました'); return }
    setShifts(shifts.filter(s => s.id !== shift.id))
    setDayDetailDate(null)
    toast.success('シフトを取り消しました')
  }

  async function handleModification() {
    if (!modTarget || !modForm.reason) { toast.error('理由を入力してください'); return }
    const [{ error }, { error: statusError }] = await Promise.all([
      supabase.from('shift_modification_requests').insert({
        shift_id: modTarget.id, requested_by: userId,
        new_date: modForm.new_date || null, new_start_time: modForm.new_start_time || null, new_end_time: modForm.new_end_time || null,
        reason: modForm.reason,
      }),
      supabase.from('shifts').update({ status: 'modification_requested' }).eq('id', modTarget.id),
    ])
    if (error || statusError) { toast.error('申請に失敗しました'); return }
    setShifts(shifts.map(s => s.id === modTarget.id ? { ...s, status: 'modification_requested' as ShiftStatus } : s))
    toast.success('修正申請を送信しました')
    setModOpen(false)
    const { data: admins } = await supabase.from('users').select('id').eq('store_id', storeId).eq('role', 'admin')
    if (admins?.length) {
      const title = 'シフト修正申請が届きました'
      const body = `${format(new Date(modTarget.date), 'M/d(E)', { locale: ja })} のシフトへの修正申請`
      await supabase.from('notifications').insert(
        admins.map(a => ({ user_id: a.id, title, body, link: '/admin/modification-requests' }))
      )
      admins.forEach(a => sendPushNotification(a.id, title, body, '/admin/modification-requests'))
    }
  }

  return (
    <div className="space-y-4">
      <Card elevated className="rounded-none border-x-0 md:rounded-lg md:border-x">
        <CardHeader className="px-4 md:px-6">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="p-1.5 -ml-1.5 rounded-full hover:bg-muted text-muted-foreground shrink-0"
              aria-label="メニュー"
            >
              <Menu className="h-5 w-5" />
            </button>

            {view === 'month' || view === 'week' || view === 'day' ? (
              <div className="flex items-center gap-0.5 min-w-0 flex-1">
                <button type="button" onClick={goPrev} className="p-1 rounded-full hover:bg-muted text-muted-foreground shrink-0" aria-label="前へ">
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <h1 className="text-base font-bold tracking-tight truncate px-0.5 min-w-0">
                  {view === 'month' && (
                    <MonthYearPicker
                      value={calAnchor}
                      onChange={d => { setCalDirection(d > calAnchor ? 'next' : 'prev'); setCalAnchor(d) }}
                    >
                      {format(calAnchor, 'yyyy年M月', { locale: ja })}
                    </MonthYearPicker>
                  )}
                  {view === 'week' && (() => {
                    const weekStart = startOfWeek(calAnchor)
                    const weekEnd = addDays(weekStart, 6)
                    return `${format(weekStart, 'M/d', { locale: ja })}〜${format(weekEnd, 'M/d', { locale: ja })}`
                  })()}
                  {view === 'day' && format(calAnchor, 'M月d日(E)', { locale: ja })}
                </h1>
                <button type="button" onClick={goNext} className="p-1 rounded-full hover:bg-muted text-muted-foreground shrink-0" aria-label="次へ">
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <h1 className="text-base font-bold tracking-tight">シフト一覧</h1>
            )}

            <div className="flex items-center gap-1 shrink-0">
              <Link
                href="/notifications"
                className="p-1.5 rounded-full hover:bg-muted text-muted-foreground"
                aria-label="通知"
              >
                <Bell className="h-5 w-5" />
              </Link>
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className="p-1.5 rounded-full hover:bg-muted text-muted-foreground"
                aria-label="シフトを検索"
              >
                <Search className="h-5 w-5" />
              </button>
            </div>
          </div>
        </CardHeader>
        {showPwaBanner && (
          <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center pointer-events-none md:px-3 md:pb-3">
            <div className="pointer-events-auto w-full md:max-w-sm rounded-t-2xl md:rounded-2xl border-t md:border shadow-xl animate-in slide-in-from-bottom fade-in-0 duration-300 bg-popover p-4 pb-[calc(1rem_+_env(safe-area-inset-bottom))] md:pb-4">
              <div className="mx-auto -mt-1 mb-2 h-1 w-9 rounded-full bg-foreground/15 md:hidden" />

              <div className="flex items-start gap-3 mb-4">
                <div className="h-11 w-11 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--brand-accent)' }}>
                  <Smartphone className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-bold">ホーム画面に追加する</p>
                  <p className="text-sm text-muted-foreground mt-0.5">プッシュ通知も受け取れるようになります</p>
                </div>
                <button type="button" onClick={() => setShowPwaBanner(false)} className="p-1 -mt-1 -mr-1 text-muted-foreground shrink-0" aria-label="閉じる">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="rounded-lg bg-muted/50 p-3.5 mb-3 space-y-2.5">
                <ol className="space-y-2.5">
                  {[
                    '画面下(または上)の「…」をタップ(共有アイコンが直接あればそれをタップ)',
                    '「共有」→「ホーム画面に追加」を選ぶ',
                    '「ウェブアプリとして開く」をONにして「追加」',
                  ].map((step, i) => (
                    <li key={step} className="flex items-start gap-2.5">
                      <span
                        className="h-5 w-5 rounded-full text-white text-[11px] font-bold flex items-center justify-center shrink-0"
                        style={{ backgroundColor: 'var(--brand-accent)' }}
                      >
                        {i + 1}
                      </span>
                      <span className="text-sm leading-5">{step}</span>
                    </li>
                  ))}
                </ol>
                <div className="flex items-start gap-2 rounded-lg bg-[color-mix(in_oklch,var(--status-submitted)_18%,transparent)] p-2.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" style={{ color: 'var(--status-submitted)' }} />
                  <p className="text-xs leading-5">手順3の「ウェブアプリとして開く」が通知受け取りに必要です</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowPwaBanner(false)}
                  className="flex-1 h-10 rounded-lg border text-sm font-medium hover:bg-muted/40 transition-colors"
                >
                  後で
                </button>
              </div>
              <button type="button" onClick={dismissPwaBannerForever} className="w-full text-center text-xs text-muted-foreground mt-2.5">
                次回以降表示しない
              </button>
            </div>
          </div>
        )}
        <CardContent className="px-0 md:px-6">
          {view === 'month' && (
            <>
              <Link
                href="/cast/rewards"
                className="flex items-center gap-3 mx-4 md:mx-0 mb-3 px-3 py-2.5 rounded-lg border hover:bg-muted/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-muted-foreground">{rewardSummary.monthLabel}ここまでの売上</p>
                  <div className="flex items-baseline gap-1.5 flex-wrap">
                    <p className="text-base font-bold tabular-nums">¥{rewardSummary.thisMonthTotal.toLocaleString()}</p>
                    {rewardDelta != null && (
                      <span className={cn(
                        'text-[10px] font-semibold',
                        rewardDelta > 0.5 ? 'text-positive' : rewardDelta < -0.5 ? 'text-destructive' : 'text-muted-foreground'
                      )}>
                        {rewardDelta > 0 ? '+' : ''}{rewardDelta.toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                    提出済み {submittedCountThisMonth}件・確定{confirmedCountThisMonth}件
                  </p>
                </div>
                {rewardSummary.monthlyGoal != null && (
                  <div className="flex flex-col items-center shrink-0">
                    <GoalRing percent={rewardGoalProgress ?? 0} size={36} stroke={4} textClassName="text-[9px] font-bold" />
                    <p className="text-[9px] text-muted-foreground mt-0.5 tabular-nums">目標</p>
                  </div>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </Link>
              <div className="flex items-center justify-between mx-4 md:mx-0 mb-2 gap-2">
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground flex-nowrap overflow-x-auto">
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_DOT.submitted }} />提出済み
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_DOT.confirmed }} />確定
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_DOT.rejected }} />差し戻し
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_DOT.modification_requested }} />修正依頼中
                  </span>
                </div>
                <div className="inline-flex rounded-full bg-muted p-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setCalendarMode('time')}
                    className={cn(
                      'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                      calendarMode === 'time' ? 'bg-[var(--brand-accent)] text-white' : 'text-muted-foreground'
                    )}
                  >
                    時間表示
                  </button>
                  <button
                    type="button"
                    onClick={() => setCalendarMode('amount')}
                    className={cn(
                      'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                      calendarMode === 'amount' ? 'bg-[var(--brand-accent)] text-white' : 'text-muted-foreground'
                    )}
                  >
                    金額表示
                  </button>
                </div>
              </div>
              <ShiftCalendar
                shifts={shifts}
                onDayClick={handleDayClick}
                current={calAnchor}
                direction={calDirection}
                onNavigate={dir => (dir === 'next' ? goNext() : goPrev())}
                mode={calendarMode}
                amountByDate={amountByDate}
                showChipLabel={false}
              />
            </>
          )}

          {view === 'week' && (
            <ShiftTimeGrid
              days={Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(calAnchor), i))}
              shiftsOn={shiftsOn}
              onDayClick={handleDayClick}
              locationLabelOf={locationLabelOf}
              onNavigate={dir => (dir === 'next' ? goNext() : goPrev())}
            />
          )}

          {view === 'day' && (
            <ShiftTimeGrid
              days={[calAnchor]}
              shiftsOn={shiftsOn}
              onDayClick={handleDayClick}
              locationLabelOf={locationLabelOf}
              onNavigate={dir => (dir === 'next' ? goNext() : goPrev())}
            />
          )}
          {view === 'list' && (
            <>
              {shifts.length === 0 && (
                <p className="text-center text-muted-foreground py-8 text-sm">シフトがありません</p>
              )}

              {/* モバイル: カードレイアウト */}
              {shifts.length > 0 && (
                <div className="md:hidden space-y-2 px-4">
                  {shifts.map(shift => (
                    <div key={shift.id} className="rounded-lg border p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sm">{format(new Date(shift.date), 'M月d日(E)', { locale: ja })}</span>
                        <Badge variant={STATUS_VARIANT[shift.status]}>{STATUS_LABEL[shift.status]}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground flex items-center gap-1 flex-wrap">
                        <span>{shift.start_time.slice(0, 5)} 〜 {shift.end_time.slice(0, 5)}</span>
                        {locationMode !== 'none' && (
                          <>
                            <span>・</span>
                            <span>
                              {locationMode === 'area_only' && (shift.areas?.name ?? '—')}
                              {locationMode === 'room' && (shift.rooms?.name ?? '—')}
                              {locationMode === 'area_and_room' && ([shift.areas?.name, shift.rooms?.name].filter(Boolean).join(' / ') || '—')}
                            </span>
                          </>
                        )}
                      </div>
                      {(canEditDirectly(shift) || canRequestModification(shift)) && (
                        <div className="flex gap-2 pt-1">
                          {canEditDirectly(shift) && (
                            <>
                              <Button size="sm" variant="outline" className="flex-1" onClick={() => openEdit(shift)}>
                                <Pencil className="h-3.5 w-3.5 mr-1" />編集
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => handleCancel(shift)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                          {canRequestModification(shift) && (
                            <Button size="sm" variant="outline" className="flex-1" onClick={() => openModification(shift)}>
                              <FileEdit className="h-3.5 w-3.5 mr-1" />修正申請
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* デスクトップ: テーブル */}
              {shifts.length > 0 && (
                <Table className="hidden md:table">
                  <TableHeader>
                    <TableRow>
                      <TableHead>日付</TableHead>
                      <TableHead>時間</TableHead>
                      {locationMode !== 'none' && <TableHead>場所</TableHead>}
                      <TableHead>ステータス</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shifts.map(shift => (
                      <TableRow key={shift.id}>
                        <TableCell>{format(new Date(shift.date), 'M/d(E)', { locale: ja })}</TableCell>
                        <TableCell>{shift.start_time.slice(0, 5)} 〜 {shift.end_time.slice(0, 5)}</TableCell>
                        {locationMode !== 'none' && (
                          <TableCell>
                            {locationMode === 'area_only' && (shift.areas?.name ?? '—')}
                            {locationMode === 'room' && (shift.rooms?.name ?? '—')}
                            {locationMode === 'area_and_room' && [shift.areas?.name, shift.rooms?.name].filter(Boolean).join(' / ') || '—'}
                          </TableCell>
                        )}
                        <TableCell><Badge variant={STATUS_VARIANT[shift.status]}>{STATUS_LABEL[shift.status]}</Badge></TableCell>
                        <TableCell className="text-right space-x-1">
                          {canEditDirectly(shift) && (
                            <>
                              <Button size="icon" variant="ghost" onClick={() => openEdit(shift)}><Pencil className="h-3.5 w-3.5" /></Button>
                              <Button size="icon" variant="ghost" onClick={() => handleCancel(shift)}><Trash2 className="h-3.5 w-3.5" /></Button>
                            </>
                          )}
                          {canRequestModification(shift) && (
                            <Button size="sm" variant="outline" onClick={() => openModification(shift)}>
                              <FileEdit className="h-3.5 w-3.5 mr-1" />修正申請
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {menuOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenuOpen(false)} />
          <aside className="relative w-64 flex flex-col h-full bg-card shadow-xl border-r">
            <div className="px-4 py-4 border-b flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <Logo className="h-6 w-6 shrink-0" style={{ color: 'var(--brand-accent)' }} />
                <p className="font-bold text-lg tracking-tight truncate">{storeName ?? 'CalendarApp'}</p>
              </div>
              <button type="button" onClick={() => setMenuOpen(false)} className="p-1 rounded-md hover:bg-muted shrink-0" aria-label="閉じる">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
              {([
                ['month', '月表示', CalendarDays],
                ['week', '週表示', CalendarRange],
                ['day', '日表示', CalendarClock],
                ['list', 'リスト表示', List],
              ] as const).map(([mode, label, Icon]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => { setView(mode); setMenuOpen(false); if (mode !== 'month') cancelBulkAdd() }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm transition-colors ${view === mode ? 'bg-muted font-medium' : 'hover:bg-muted/60'}`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                  {view === mode && <Check className="h-4 w-4 ml-auto" style={{ color: 'var(--brand-accent)' }} />}
                </button>
              ))}
              <div className="my-1 border-t" />
              <button
                type="button"
                onClick={startBulkAdd}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm transition-colors hover:bg-muted/60"
              >
                <CalendarPlus className="h-4 w-4 shrink-0" />
                まとめて追加
              </button>
            </nav>
            <div className="px-2 py-2 border-t">
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors"
              >
                <LogOut className="h-4 w-4 shrink-0" />
                ログアウト
              </button>
            </div>
          </aside>
        </div>
      )}

      <Dialog open={searchOpen} onOpenChange={open => { setSearchOpen(open); if (!open) setSearchQuery('') }}>
        <DialogContent variant="top">
          <DialogHeader><DialogTitle>シフトを検索</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-2">
            <Input
              autoFocus
              placeholder="日付・場所・備考で検索"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            <div className="space-y-1 max-h-[60dvh] overflow-y-auto">
              {(() => {
                const q = searchQuery.trim().toLowerCase()
                if (!q) {
                  return <p className="text-sm text-muted-foreground text-center py-6">キーワードを入力してください</p>
                }
                const results = shifts.filter(s => {
                  const dateLabel = format(new Date(`${s.date}T00:00:00`), 'yyyy年M月d日(E)', { locale: ja })
                  const haystack = [
                    dateLabel, locationLabelOf(s), s.notes, STATUS_LABEL[s.status],
                  ].filter(Boolean).join(' ').toLowerCase()
                  return haystack.includes(q)
                })
                if (results.length === 0) {
                  return <p className="text-sm text-muted-foreground text-center py-6">見つかりませんでした</p>
                }
                return results.map(shift => (
                  <button
                    key={shift.id}
                    type="button"
                    onClick={() => {
                      setSearchOpen(false)
                      setSearchQuery('')
                      setDayDetailDateRaw(shift.date)
                      setDetailShiftId(shift.id)
                    }}
                    className="w-full flex items-center gap-3 pl-3 pr-2 py-2.5 rounded-md hover:bg-muted/40 transition-colors text-left border-b last:border-b-0"
                  >
                    <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ backgroundColor: 'var(--brand-accent)' }} />
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium">{format(new Date(`${shift.date}T00:00:00`), 'M月d日(E)', { locale: ja })}</span>
                      <span className="block text-xs text-muted-foreground truncate">
                        {shift.start_time.slice(0, 5)}〜{shift.end_time.slice(0, 5)}
                        {locationLabelOf(shift) && ` ・ ${locationLabelOf(shift)}`}
                      </span>
                    </span>
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_DOT[shift.status] }} />
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                ))
              })()}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!dayDetailDate} onOpenChange={openState => { if (!openState) setDayDetailDate(null) }}>
        <DialogContent variant="sheet" onDismiss={() => setDayDetailDate(null)}>
          {(() => {
            const dayShifts = dayDetailDate ? shifts.filter(s => s.date === dayDetailDate) : []
            const activeShift = detailShiftId
              ? dayShifts.find(s => s.id === detailShiftId) ?? null
              : null

            if (activeShift) {
              const shift = activeShift
              const badges = checklistBadges(shift.checklist_answers)
              const locationLabel = locationLabelOf(shift)
              return (
                <>
                  <DialogHeader className="flex-row items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDetailShiftId(null)}
                      className="p-1 -ml-1 rounded-full hover:bg-muted text-muted-foreground shrink-0"
                      aria-label="一覧に戻る"
                    >
                      <ChevronLeft className="h-5 w-5" />
                    </button>
                    <DialogTitle className="flex-1 text-center">{locationLabel ?? 'シフト詳細'}</DialogTitle>
                    <span className="w-7 shrink-0" />
                  </DialogHeader>

                  <div className="mt-3 space-y-0 -mx-4 md:mx-0">
                    <div className="flex items-center justify-center gap-4 px-4 py-3">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">開始</p>
                        <p className="text-lg font-bold tabular-nums">{shift.start_time.slice(0, 5)}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">終了</p>
                        <p className="text-lg font-bold tabular-nums">{shift.end_time.slice(0, 5)}</p>
                      </div>
                    </div>

                    <div className="border-t px-4 py-3 flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_DOT[shift.status] }} />
                      <span className="text-sm">{STATUS_LABEL[shift.status]}</span>
                    </div>

                    {salesByShiftId[shift.id] && (
                      <div className="border-t px-4 py-3 flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">売上 / 女子給</span>
                        <span className="tabular-nums">
                          ¥{salesByShiftId[shift.id].amount.toLocaleString()}
                          <span className="text-muted-foreground"> / </span>
                          ¥{salesByShiftId[shift.id].reward.toLocaleString()}
                        </span>
                      </div>
                    )}

                    {shift.status === 'rejected' && shift.admin_note && (
                      <div className="border-t px-4 py-3">
                        <div className="flex gap-2 bg-destructive/10 border border-destructive/30 rounded-lg p-2.5">
                          <StickyNote className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                          <div>
                            <p className="text-[10px] font-semibold text-destructive">差し戻し理由</p>
                            <p className="text-xs text-foreground mt-0.5">{shift.admin_note}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    {locationLabel && (
                      <div className="border-t px-4 py-3 flex items-center gap-2.5 text-sm">
                        <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-muted-foreground">場所</span>
                        <span className="ml-auto">{locationLabel}</span>
                      </div>
                    )}

                    {shift.notes && (
                      <div className="border-t px-4 py-3 flex items-start gap-2.5 text-sm">
                        <StickyNote className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                        <span className="text-muted-foreground shrink-0">備考</span>
                        <span className="ml-auto text-right">{shift.notes}</span>
                      </div>
                    )}

                    {badges.length > 0 && (
                      <div className="border-t px-4 py-3 space-y-1.5 text-sm">
                        <span className="text-muted-foreground">確認項目</span>
                        <div className="flex flex-wrap gap-1">
                          {badges.map(label => <Badge key={label} variant="outline" className="text-[10px]">{label}</Badge>)}
                        </div>
                      </div>
                    )}
                    <div className="border-t" />
                  </div>

                  {(canEditDirectly(shift) || canRequestModification(shift)) && (
                    <div className="flex items-center gap-2 pt-1">
                      {canEditDirectly(shift) && (
                        <>
                          <Button variant="elevated" size="sm" className="flex-1" onClick={() => { setDayDetailDate(null); openEdit(shift) }}>
                            <Pencil className="h-3.5 w-3.5 mr-1" />編集
                          </Button>
                          <Button size="icon-sm" variant="destructive" onClick={() => handleCancel(shift)} aria-label="取消">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                      {canRequestModification(shift) && (
                        <Button variant="elevated" size="sm" className="flex-1" onClick={() => { setDayDetailDate(null); openModification(shift) }}>
                          <FileEdit className="h-3.5 w-3.5 mr-1" />修正申請
                        </Button>
                      )}
                    </div>
                  )}
                </>
              )
            }

            return (
              <>
                <div
                  className="-mx-4 -mt-2 mb-3 px-4 py-3 flex items-center gap-2 text-white"
                  style={{ backgroundColor: 'var(--brand-accent)' }}
                >
                  <CalendarDays className="h-4 w-4 shrink-0" />
                  <span className="font-semibold">
                    {dayDetailDate && format(new Date(`${dayDetailDate}T00:00:00`), 'M月d日(E)', { locale: ja })}
                  </span>
                </div>
                <div className="space-y-1">
                  {dayShifts.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">この日のシフトはありません</p>
                  )}
                  {dayShifts.map(shift => (
                    <button
                      key={shift.id}
                      type="button"
                      onClick={() => setDetailShiftId(shift.id)}
                      className="w-full flex items-center gap-3 pl-3 pr-2 py-2 rounded-md hover:bg-muted/40 transition-colors text-left border-b last:border-b-0"
                    >
                      <span className="w-[3px] self-stretch rounded-full shrink-0" style={{ backgroundColor: 'var(--brand-accent)' }} />
                      <span className="shrink-0 text-center leading-tight">
                        <span className="block text-sm font-semibold tabular-nums">{shift.start_time.slice(0, 5)}</span>
                        <span className="block text-xs text-muted-foreground tabular-nums">{shift.end_time.slice(0, 5)}</span>
                      </span>
                      <span className="flex-1 text-sm">{locationLabelOf(shift) ?? 'シフト'}</span>
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: STATUS_DOT[shift.status] }} />
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => { const d = dayDetailDate; setDayDetailDate(null); openNew(d ?? undefined) }}
                    className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-md border border-dashed text-sm font-medium mt-2"
                    style={{ borderColor: 'var(--brand-accent)', color: 'var(--brand-accent)' }}
                  >
                    <Plus className="h-4 w-4" />この日にシフトを追加する
                  </button>
                </div>
              </>
            )
          })()}
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'シフト編集' : 'シフト提出'}</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            {!editing && isPastDeadline && (
              <div className="px-3 py-2 rounded-lg border border-destructive/30 bg-destructive/10 text-xs text-destructive">
                シフト提出の締切を過ぎています。このまま提出はできません。管理者にお問い合わせください
              </div>
            )}
            <div className="space-y-1.5"><Label>日付 *</Label><Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5 min-w-0"><Label>開始時間</Label><Input type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })} /></div>
              <div className="space-y-1.5 min-w-0"><Label>終了時間</Label><Input type="time" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })} /></div>
            </div>
            {(locationMode === 'area_only' || locationMode === 'area_and_room') && areas.length > 0 && (
              <div className="space-y-1.5">
                <Label>{areaLabel}</Label>
                <Select value={form.area_id || 'none'} onValueChange={v => setForm({ ...form, area_id: v === 'none' ? '' : (v ?? ''), room_id: '' })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={`${areaLabel}を選択`}>
                      {form.area_id ? (areas.find(a => a.id === form.area_id)?.name ?? '未選択') : '未選択'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未選択</SelectItem>
                    {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {(locationMode === 'room' || (locationMode === 'area_and_room' && form.area_id)) && filteredRooms.length > 0 && (
              <div className="space-y-1.5">
                <Label>{roomLabel}</Label>
                <Select value={form.room_id || 'none'} onValueChange={v => setForm({ ...form, room_id: v === 'none' ? '' : (v ?? '') })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={`${roomLabel}を選択（任意）`}>
                      {form.room_id ? (filteredRooms.find(r => r.id === form.room_id)?.name ?? '未選択') : '未選択'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未選択</SelectItem>
                    {filteredRooms.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5"><Label>備考</Label><Textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
            {checklistItems.length > 0 && (
              <div className="space-y-3">
                <Label>確認項目</Label>
                {checklistItems.map(item => (
                  item.item_type === 'select' ? (
                    <div key={item.id} className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-normal">{item.label}</Label>
                      <Select
                        value={(form.checklist_answers[item.id] as string) || 'none'}
                        onValueChange={v => setChecklistSelect(item.id, v === 'none' ? '' : (v ?? ''))}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>{(form.checklist_answers[item.id] as string) || '未選択'}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">未選択</SelectItem>
                          {item.options.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <label key={item.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={!!form.checklist_answers[item.id]}
                        onCheckedChange={() => toggleChecklistItem(item.id)}
                        className="data-checked:border-[var(--brand-accent)] data-checked:bg-[var(--brand-accent)]"
                      />
                      {item.label}
                    </label>
                  )
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)}>キャンセル</Button>
              <Button variant="elevated" onClick={handleSave} disabled={!form.date}>提出</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkSheetOpen} onOpenChange={setBulkSheetOpen}>
        <DialogContent variant="sheet" onDismiss={() => setBulkSheetOpen(false)}>
          <DialogHeader><DialogTitle>まとめてシフト提出</DialogTitle></DialogHeader>
          <div className="space-y-5 mt-2">
            {isPastDeadline && (
              <div className="px-3 py-2 rounded-lg border border-destructive/30 bg-destructive/10 text-xs text-destructive">
                シフト提出の締切を過ぎています。このまま提出はできません。管理者にお問い合わせください
              </div>
            )}
            <div>
              <Label className="text-xs text-muted-foreground">日付を選ぶ（複数タップできます）</Label>
              <div className="mt-1.5">
                <ShiftCalendar shifts={shifts} onDayClick={toggleBulkDate} selectedDates={bulkDates} />
              </div>
            </div>

            {bulkDates.size > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">選んだ日（{bulkDates.size}件）</Label>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {Array.from(bulkDates).sort().map(date => (
                    <span key={date} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs">
                      {format(new Date(`${date}T00:00:00`), 'M/d(E)', { locale: ja })}
                      <button
                        type="button"
                        onClick={() => setBulkDates(prev => {
                          const next = new Set(prev)
                          next.delete(date)
                          setBulkTimes(t => { const nt = { ...t }; delete nt[date]; return nt })
                          return next
                        })}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`${date}を選択解除`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {bulkDates.size > 0 && (
            <>
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">テンプレの時間（タップで全日に適用）</Label>
                <button
                  type="button"
                  onClick={() => setTemplateEditorOpen(o => !o)}
                  className="text-xs rounded-full border px-3 py-1 shrink-0"
                >
                  設定
                </button>
              </div>
              <div className="flex flex-col gap-2 mt-2">
                {bulkTemplates.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => applyTemplateToAll(t)}
                      className="flex-1 rounded-lg border px-3 py-2.5 text-sm text-left font-medium hover:bg-muted/40 transition-colors"
                    >
                      {t.start}〜{t.end}
                    </button>
                    {templateEditorOpen && (
                      <button
                        type="button"
                        onClick={() => removeTemplate(i)}
                        className="p-1.5 rounded-full text-muted-foreground hover:bg-muted shrink-0"
                        aria-label="テンプレを削除"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {templateEditorOpen && (
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <TimeSelect value={newTemplate.start} onChange={v => setNewTemplate({ ...newTemplate, start: v })} />
                  <span className="text-sm text-muted-foreground">〜</span>
                  <TimeSelect value={newTemplate.end} onChange={v => setNewTemplate({ ...newTemplate, end: v })} />
                  <Button size="sm" variant="outline" onClick={addTemplate}>テンプレに追加</Button>
                </div>
              )}
            </div>

            <div>
              <Label className="text-xs text-muted-foreground">選んだ日の時間（1日ずつ変えられます）</Label>
              <div className="flex flex-col gap-3 mt-2">
                {Array.from(bulkDates).sort().map(date => {
                  const t = bulkTimes[date] ?? bulkTemplates[0]
                  return (
                    <div key={date} className="rounded-lg border p-2 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">
                          {format(new Date(`${date}T00:00:00`), 'M/d(E)', { locale: ja })}
                        </span>
                        <div className="flex flex-wrap justify-end gap-1">
                          {bulkTemplates.map((tpl, i) => (
                            <button
                              key={i}
                              type="button"
                              onClick={() => applyTemplateToDate(date, tpl)}
                              className={cn(
                                'text-xs rounded-full border px-2.5 py-1 shrink-0 transition-colors',
                                t.start === tpl.start && t.end === tpl.end
                                  ? 'text-white border-transparent'
                                  : 'hover:bg-muted/40'
                              )}
                              style={t.start === tpl.start && t.end === tpl.end ? { backgroundColor: 'var(--brand-accent)' } : undefined}
                            >
                              {tpl.start}〜{tpl.end}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <TimeSelect value={t.start} onChange={v => setBulkDateTime(date, 'start', v)} />
                        <span className="text-sm text-muted-foreground">〜</span>
                        <TimeSelect value={t.end} onChange={v => setBulkDateTime(date, 'end', v)} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {(locationMode === 'area_only' || locationMode === 'area_and_room') && areas.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{areaLabel}</Label>
                <Select value={bulkForm.area_id || 'none'} onValueChange={v => setBulkForm({ ...bulkForm, area_id: v === 'none' ? '' : (v ?? ''), room_id: '' })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={`${areaLabel}を選択`}>
                      {bulkForm.area_id ? (areas.find(a => a.id === bulkForm.area_id)?.name ?? '未選択') : '未選択'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未選択</SelectItem>
                    {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {(locationMode === 'room' || (locationMode === 'area_and_room' && bulkForm.area_id)) && bulkFilteredRooms.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{roomLabel}</Label>
                <Select value={bulkForm.room_id || 'none'} onValueChange={v => setBulkForm({ ...bulkForm, room_id: v === 'none' ? '' : (v ?? '') })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={`${roomLabel}を選択（任意）`}>
                      {bulkForm.room_id ? (bulkFilteredRooms.find(r => r.id === bulkForm.room_id)?.name ?? '未選択') : '未選択'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">未選択</SelectItem>
                    {bulkFilteredRooms.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">備考</Label>
              <Textarea value={bulkForm.notes} onChange={e => setBulkForm({ ...bulkForm, notes: e.target.value })} rows={2} />
            </div>
            {checklistItems.length > 0 && (
              <div className="space-y-3">
                <Label className="text-xs text-muted-foreground">確認項目</Label>
                {checklistItems.map(item => (
                  item.item_type === 'select' ? (
                    <div key={item.id} className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground font-normal">{item.label}</Label>
                      <Select
                        value={(bulkForm.checklist_answers[item.id] as string) || 'none'}
                        onValueChange={v => setBulkChecklistSelect(item.id, v === 'none' ? '' : (v ?? ''))}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>{(bulkForm.checklist_answers[item.id] as string) || '未選択'}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">未選択</SelectItem>
                          {item.options.map(opt => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <label key={item.id} className="flex items-center gap-2 text-sm cursor-pointer">
                      <Checkbox
                        checked={!!bulkForm.checklist_answers[item.id]}
                        onCheckedChange={() => toggleBulkChecklistItem(item.id)}
                        className="data-checked:border-[var(--brand-accent)] data-checked:bg-[var(--brand-accent)]"
                      />
                      {item.label}
                    </label>
                  )
                ))}
              </div>
            )}
            </>
            )}

            <Button
              className="w-full rounded-full"
              variant="elevated"
              disabled={bulkDates.size === 0 || bulkSaving}
              onClick={handleBulkSave}
            >
              {bulkSaving ? '提出中...' : `${bulkDates.size}件のシフトを提出`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelTarget} onOpenChange={openState => { if (!openState) setCancelTarget(null) }}>
        <DialogContent>
          <DialogHeader><DialogTitle>シフトを取り消しますか?</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            {cancelTarget && (
              <p className="text-sm text-muted-foreground">
                {format(new Date(cancelTarget.date), 'M月d日(E)', { locale: ja })} のシフトを取り消します。この操作は元に戻せません。
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCancelTarget(null)}>キャンセル</Button>
              <Button variant="destructive" onClick={confirmCancel}>取り消す</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={modOpen} onOpenChange={setModOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>修正申請</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5"><Label>変更後の日付</Label><Input type="date" value={modForm.new_date} onChange={e => setModForm({ ...modForm, new_date: e.target.value })} /></div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5 min-w-0"><Label>開始時間</Label><Input type="time" value={modForm.new_start_time} onChange={e => setModForm({ ...modForm, new_start_time: e.target.value })} /></div>
              <div className="space-y-1.5 min-w-0"><Label>終了時間</Label><Input type="time" value={modForm.new_end_time} onChange={e => setModForm({ ...modForm, new_end_time: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5">
              <Label>申請理由 *</Label>
              <Textarea
                value={modForm.reason}
                onChange={e => setModForm({ ...modForm, reason: e.target.value })}
                rows={3}
                placeholder="例: 体調不良のため出勤をキャンセルしたいです／開始時間を19時に変更したいです"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setModOpen(false)}>キャンセル</Button>
              <Button variant="elevated" onClick={handleModification} disabled={!modForm.reason}>申請する</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
