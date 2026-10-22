import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

// supabase/migrations/20261017000000_fix_notify_vacant_slots_exclude_ended.sql の静的監査。
// DBへは一切接続しない（ファイルのテキストだけを検査する。実行はしない）。
//
// Push不具合③（v18レビュー対応）: notify_vacant_slots が is_published のみで対象を判定しており、
// 終了済み（日またぎ含む）の空き枠しかない店舗でも通知を作成してしまっていた。この migration は
// 既存の public.vacant_slot_ends_at（20260919000000で定義済み。キャスト画面の isVacantSlotEnded と
// 同じ日またぎ対応ロジック）を使って、終了済みの枠を候補から除外する。

const MIGRATION_PATH = fileURLToPath(
  new URL('../supabase/migrations/20261017000000_fix_notify_vacant_slots_exclude_ended.sql', import.meta.url)
)
const sql = readFileSync(MIGRATION_PATH, 'utf8')

function extractFunctionBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`)
  if (start === -1) throw new Error(`function not found in migration: ${name}`)
  const end = sql.indexOf('\n$$;\n', start)
  if (end === -1) throw new Error(`function body terminator ($$;) not found for: ${name}`)
  return sql.slice(start, end)
}

describe('既存migrationを編集していないことの確認', () => {
  it('20261007030000（直前のnotify_vacant_slots定義）には今回の変更が含まれていない（新規migrationのみを追加した）', () => {
    const prevPath = fileURLToPath(
      new URL('../supabase/migrations/20261007030000_fix_vacant_slot_notify_5s_guard_scope.sql', import.meta.url)
    )
    const prevSql = readFileSync(prevPath, 'utf8')
    expect(prevSql).not.toContain('vacant_slot_ends_at(date, start_time, end_time)')
  })
})

describe('notify_vacant_slots: 終了済みの空き枠を候補から除外する', () => {
  const body = extractFunctionBody('notify_vacant_slots')

  it('v_current_slotsの取得クエリに、vacant_slot_ends_at による終了時刻フィルタが追加されている', () => {
    expect(body).toMatch(
      /from public\.vacant_slots\s*\n\s*where store_id = v_store and is_published\s*\n\s*and public\.vacant_slot_ends_at\(date, start_time, end_time\) > timezone\('Asia\/Tokyo', now\(\)\)/
    )
  })

  it('終了時刻フィルタは store_id・is_published と同じ一つのクエリ内にあり、別クエリでの事後フィルタではない（取り残しを防ぐ）', () => {
    const fromIdx = body.indexOf('from public.vacant_slots')
    const endedFilterIdx = body.indexOf('vacant_slot_ends_at(date, start_time, end_time)')
    const nextStatementIdx = body.indexOf('if array_length(v_current_slots, 1) is null then')
    expect(fromIdx).toBeGreaterThan(-1)
    expect(endedFilterIdx).toBeGreaterThan(fromIdx)
    expect(endedFilterIdx).toBeLessThan(nextStatementIdx)
  })

  it('有効な空き枠が0件（全て終了済み）なら、従来どおり例外を発生させる（通知を作成しない）', () => {
    expect(body).toContain("raise exception '通知できる公開中の空き枠がありません' using errcode = 'P0002';")
  })

  it('権限チェック・5秒ガード・組み合わせ一致による再送抑止は変更していない（既存ロジックを維持）', () => {
    expect(body).toContain("if auth.uid() is null or public.my_role() is distinct from 'admin' or v_store is null then")
    expect(body).toContain("raise exception '権限がありません' using errcode = '42501';")
    expect(body).toContain("if v_last.created_at >= now() - interval '5 seconds' then")
    expect(body).toContain('if found and v_last.slot_ids = v_current_slots then')
  })

  it('通知作成ループ・notify_logへの記録は変更していない（有効な枠のみを反映したv_current_slotsがそのまま使われる）', () => {
    expect(body).toContain("select id from public.users where store_id = v_store and role = 'cast' and is_active order by id")
    expect(body).toContain('insert into public.vacant_slot_notify_log (store_id, notified_by, slot_ids, notified_count)')
  })

  it('権限（grant/revoke）は変更していない', () => {
    expect(sql).toContain('revoke all on function public.notify_vacant_slots(boolean) from public, anon;')
    expect(sql).toContain('grant execute on function public.notify_vacant_slots(boolean) to authenticated;')
  })
})
