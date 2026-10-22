import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'

// 通知の作成・Web Push送信は、ブラウザ側では行わない。
//  ・キャストはRLSにより自分自身のusersしか参照できない（同店舗の管理者を検索しても0件になる）
//  ・notifications への直接INSERT・任意の宛先/文面/リンクのPush送信は閉じてある（DB・API側）
// 通知の宛先・文面・リンクの決定は、DB内の専用経路（RPC・トリガー）が担う。ブラウザ側のコードがそれに戻らないことを静的に固定する。
const ROOT = fileURLToPath(new URL('../', import.meta.url))
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')
function listSources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap(name => {
    const rel = `${dir}/${name}`
    return statSync(join(ROOT, rel)).isDirectory() ? listSources(rel) : /\.(ts|tsx)$/.test(name) ? [rel] : []
  })
}
const BROWSER_SOURCES = [...listSources('src/components'), ...listSources('src/app/(app)'), ...listSources('src/hooks'), ...listSources('src/lib').filter(f => !f.endsWith('database.types.ts'))]

describe('通知の作成・送信をブラウザ側で行わない（静的検査）', () => {
  it('ブラウザ側のコードは notifications テーブルへ INSERT しない（更新は既読化 read_at のみ）', () => {
    const offenders: string[] = []
    for (const rel of BROWSER_SOURCES) {
      const text = read(rel)
      for (const m of text.matchAll(/\.from\(\s*['"]notifications['"]\s*\)([\s\S]{0,120})/g)) {
        if (/\.insert\(|\.delete\(|\.upsert\(/.test(m[1])) offenders.push(rel)
        if (/\.update\(/.test(m[1]) && !/read_at/.test(m[1])) offenders.push(rel + '（read_at以外の更新）')
      }
    }
    expect(offenders).toEqual([])
  })

  it('キャストの画面は users テーブルから管理者を検索しない（RLSで0件になるため、宛先はDBが決める）', () => {
    const offenders: string[] = []
    for (const rel of BROWSER_SOURCES.filter(f => /cast/.test(f) || /vacant-slots/.test(f))) {
      if (/\.from\(\s*['"]users['"]\s*\)[\s\S]{0,80}\.eq\(\s*['"]role['"]\s*,\s*['"]admin['"]\s*\)/.test(read(rel))) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })

  it('旧Push送信API（/api/push/send・sendPushNotification・sendPushToUsers）を参照するコードが無い。Push送信は dispatchPush（パラメータなし）だけ', () => {
    for (const rel of [...BROWSER_SOURCES, ...listSources('src/app/api')]) {
      const text = read(rel)
      expect(text, rel).not.toMatch(/api\/push\/send|sendPushNotification\b|sendPushToUsers\b|sendPushNotificationResult\b/)
    }
    const push = read('src/lib/push.ts')
    const fn = push.slice(push.indexOf('export async function dispatchPush'))
    expect(fn).toContain("fetch('/api/push/dispatch', { method: 'POST'")
    expect(fn.slice(0, fn.indexOf('\n}\n'))).not.toMatch(/user_id|title|JSON\.stringify|body:/)
  })

  it('空き枠画面は、申請にapply_vacant_slot・承認/不承認にreview_vacant_slot_application・作成にcreate_vacant_slot・公開切替/削除/取消のRPCを使う', () => {
    const cast = read('src/components/vacant-slots/cast-vacant-slots.tsx')
    const manager = read('src/components/vacant-slots/vacant-slot-manager.tsx')
    expect(cast).toContain("rpc('apply_vacant_slot'")
    expect(cast).toContain("rpc('cancel_vacant_slot_application'")
    expect(manager).toContain("rpc('review_vacant_slot_application'")
    expect(manager).toContain("rpc('create_vacant_slot'")
    expect(manager).toContain("rpc('set_vacant_slot_published'")
    expect(manager).toContain("rpc('delete_vacant_slot'")
    expect(manager).not.toMatch(/from\(\s*['"]vacant_slot_applications['"]\s*\)\s*\.(insert|update|delete)/)
  })

  it('修正申請管理・リマインド・テスト通知は、専用のDB関数（RPC）を使う', () => {
    expect(read('src/components/shifts/modification-request-list.tsx')).toContain("rpc('review_shift_modification_request'")
    // リマインド・テスト通知のRPC呼び出し自体は notification-list-actions.ts（テスト可能な純粋関数）に切り出されている。
    // notification-list.tsx はそれをimportして呼ぶだけで、直接INSERTへ戻っていないことを確認する。
    const actions = read('src/lib/notification-list-actions.ts')
    expect(actions).toContain("rpc('send_shift_reminder'")
    expect(actions).toContain("rpc('send_test_notification'")
    const list = read('src/components/notifications/notification-list.tsx')
    expect(list).toMatch(/from ['"]@\/lib\/notification-list-actions['"]/)
    expect(list).not.toMatch(/\.rpc\(\s*['"]send_shift_reminder['"]|\.rpc\(\s*['"]send_test_notification['"]/)
  })
})
