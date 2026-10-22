import { describe, it, expect } from 'vitest'
import {
  hasArbitraryPayload, isAllowedNotificationLink, MAX_DISPATCH_PER_REQUEST, MAX_PUSH_PER_MINUTE, PENDING_WINDOW_MINUTES,
  describeOperationPushResult, describePushDispatchResult,
} from '@/lib/push-dispatch'

// Web Push送信API（/api/push/dispatch）の入力・リンク検証。
// ブラウザは宛先・タイトル・本文・リンクを指定できず、リンクはアプリ内の許可された相対パスだけ。
describe('isAllowedNotificationLink（アプリ内の許可された相対パスだけ）', () => {
  it('現行の通知が使うリンクはすべて許可される', () => {
    for (const link of [
      '/cast/vacant-slots', '/admin/vacant-slots', '/cast/shifts', '/admin/shifts', '/admin/modification-requests',
      '/admin/rewards/notice?cast_id=0b9d8f9e-1111-4222-8333-444455556666&from=2026-09-01&to=2026-09-30&notice_id=abc123',
      '/notifications', '/dashboard',
    ]) expect(isAllowedNotificationLink(link)).toBe(true)
  })

  it('リンク無し(null/undefined)は許可される', () => {
    expect(isAllowedNotificationLink(null)).toBe(true)
    expect(isAllowedNotificationLink(undefined)).toBe(true)
  })

  it('外部URL・プロトコル相対URL・javascript:・パス遡上・許可されないパスは拒否される', () => {
    for (const link of [
      'https://evil.example/', 'http://evil.example', '//evil.example', 'javascript:alert(1)', 'data:text/html,x',
      '/../etc/passwd', '/cast/../admin', '/login', '/api/push/dispatch', '/castx', 'cast/shifts', '', ' /cast/shifts',
      '/cast/shifts#frag', '/cast/shifts?x=<script>', '/cast/shifts\nSet-Cookie: a=b',
    ]) expect(isAllowedNotificationLink(link)).toBe(false)
  })

  it('文字列以外は拒否される', () => {
    for (const v of [123, {}, [], true]) expect(isAllowedNotificationLink(v)).toBe(false)
  })
})

describe('hasArbitraryPayload（任意の宛先・文面・リンクを受け取らない）', () => {
  it('ボディが空・null・空オブジェクトなら任意指定なし', () => {
    expect(hasArbitraryPayload(null)).toBe(false)
    expect(hasArbitraryPayload(undefined)).toBe(false)
    expect(hasArbitraryPayload({})).toBe(false)
  })

  it('user_id / title / body / link など、何かキーが指定されていれば拒否', () => {
    expect(hasArbitraryPayload({ user_id: '11111111-1111-4111-8111-111111111111', title: 'x' })).toBe(true)
    expect(hasArbitraryPayload({ link: 'https://evil.example' })).toBe(true)
    expect(hasArbitraryPayload({ anything: 1 })).toBe(true)
  })

  it('配列・文字列・数値のボディも拒否', () => {
    expect(hasArbitraryPayload([])).toBe(true)
    expect(hasArbitraryPayload('x')).toBe(true)
    expect(hasArbitraryPayload(1)).toBe(true)
  })
})

describe('送信の上限値', () => {
  it('1リクエストの件数・1分あたりの上限・未送信通知を送れる期間が定義されている（連続送信の抑止）', () => {
    expect(MAX_DISPATCH_PER_REQUEST).toBeGreaterThan(0)
    expect(MAX_PUSH_PER_MINUTE).toBeGreaterThanOrEqual(MAX_DISPATCH_PER_REQUEST)
    expect(PENDING_WINDOW_MINUTES).toBeGreaterThan(0)
  })
})

// 業務処理（DB操作）の成功メッセージとPush配信の結果を1つにまとめる汎用関数。
// 成功とPush失敗を別々のポップアップで連続表示すると、先に出た方を読み切る前に変わってしまい
// 「処理できなかった」と誤認されうる（空き枠まとめて通知の実機確認で再現済み）ため、
// 業務処理の成功は必ず明示したまま、Push側の状態を区別して追記する
describe('describeOperationPushResult（業務処理の結果＋Push配信の結果を1つにまとめる）', () => {
  it('Push全件成功: 業務処理の成功メッセージのみ（Pushの言及を追加しない）', () => {
    const result = describeOperationPushResult('シフトを変更しました', { ok: true, failed: 0, noSubscription: 0 })
    expect(result).toEqual({ level: 'success', message: 'シフトを変更しました' })
  })

  it('Push配信で実際に失敗した件数がある: warningレベルで、業務処理の成功は維持したまま失敗件数を追記する（通知レコード単位の「件」。人数ではない。v18レビュー対応）', () => {
    const result = describeOperationPushResult('承認して確定しました', { ok: true, failed: 2, noSubscription: 0 })
    expect(result.level).toBe('warning')
    expect(result.message).toBe('承認して確定しました（2件のプッシュ通知の送信に失敗しました（再送はできません））')
  })

  it('端末未登録は配信失敗として数えない。successレベルのまま、対象外であることだけ追記する（件数表示）', () => {
    const result = describeOperationPushResult('申請しました', { ok: true, failed: 0, noSubscription: 1 })
    expect(result.level).toBe('success')
    expect(result.message).toBe('申請しました（1件は端末未登録のためプッシュ通知の対象外でした）')
  })

  it('Pushリクエスト自体が失敗（設定不足）: 固定値の人数（「1人失敗」等）を表示せず、理由別の文言にする', () => {
    const result = describeOperationPushResult('シフトを削除しました', { ok: false, failed: 1, reason: 'vapid_not_configured' })
    expect(result.level).toBe('warning')
    expect(result.message).toBe('シフトを削除しました（プッシュ通知の送信設定が未完了のため送信できません）')
    expect(result.message).not.toMatch(/1人/)
  })

  it('Pushリクエスト自体が失敗（送信回数上限）: 理由に応じた文言になる', () => {
    const result = describeOperationPushResult('承認しました', { ok: false, failed: 1, reason: 'rate_limited' })
    expect(result.message).toContain('送信回数の上限に達しました')
  })

  it('Pushリクエスト自体が失敗（原因不明）: reasonが無い場合は汎用の失敗文言になる', () => {
    const result = describeOperationPushResult('不承認にしました', { ok: false, failed: 1 })
    expect(result.message).toBe('不承認にしました（プッシュ通知の送信に失敗しました）')
  })

  it('業務処理の成功メッセージは常に文頭に含まれる（Push側の状態によらず「処理は完了している」ことが分かる）', () => {
    for (const push of [
      { ok: true, failed: 0, noSubscription: 0 },
      { ok: true, failed: 1, noSubscription: 0 },
      { ok: true, failed: 0, noSubscription: 1 },
      { ok: false, failed: 1, reason: 'vapid_not_configured' },
    ]) {
      expect(describeOperationPushResult('却下しました', push).message.startsWith('却下しました')).toBe(true)
    }
  })
})

describe('describePushDispatchResult（dispatchPush結果 → 表示文言・duration）', () => {
  it('リクエスト自体が失敗(ok:false)なら、失敗メッセージ・duration指定なし', () => {
    const outcome = describePushDispatchResult({ ok: false, failed: 1, noSubscription: 0 }, '自分', true)
    expect(outcome).toEqual({ level: 'error', message: '自分へのプッシュ送信に失敗しました（通知はアプリ内に作成済みです）' })
  })

  it('Push送信に1件以上失敗があれば、失敗メッセージ・duration15000', () => {
    const outcome = describePushDispatchResult({ ok: true, failed: 2, noSubscription: 0 }, 'キャストA', false)
    expect(outcome).toEqual({
      level: 'error',
      message: 'キャストAへのプッシュ送信に失敗しました（通知はアプリ内に作成済みです。再送はできません）',
      duration: 15000,
    })
  })

  it('端末登録なし(noSubscription>0)は、自分宛か他人宛かで文言が変わる', () => {
    const self = describePushDispatchResult({ ok: true, failed: 0, noSubscription: 1 }, '自分', true)
    expect(self.level).toBe('error')
    expect(self.message).toBe('プッシュ通知の登録がサーバーに見つかりません。下の「オフにする」→「オンにする」を押し直して登録し直してください')
    expect(self.duration).toBe(15000)

    const other = describePushDispatchResult({ ok: true, failed: 0, noSubscription: 1 }, 'キャストA', false)
    expect(other.message).toBe('キャストAのプッシュ通知の登録がサーバーに見つかりません。本人の端末で通知を一度「オフ」→「オン」にして登録し直してもらってください')
  })

  it('全件成功なら成功メッセージを返す', () => {
    const outcome = describePushDispatchResult({ ok: true, failed: 0, noSubscription: 0 }, 'キャストA', false)
    expect(outcome).toEqual({ level: 'success', message: 'キャストAへテスト通知を送信しました（プッシュ送信済み）' })
  })
})
