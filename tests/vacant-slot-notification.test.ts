import { describe, it, expect } from 'vitest'
import { describeNotifySlotsResult } from '@/lib/vacant-slot-notification'

// 「空き枠をまとめて通知」の結果: アプリ内通知の結果とPush配信の結果を、1つのメッセージにまとめる。
// 別々のポップアップを即座に切り替えて表示すると、先に出た方を読み切る前に変わってしまい
// 「送信できなかった」と誤認されうる（実際に起きた事象）ため、両方が確定してから1つにまとめる
describe('describeNotifySlotsResult', () => {
  it('新規送信・Push全員配信成功: successレベルで、アプリ内通知とPushの両方が完了したことが分かる', () => {
    const result = describeNotifySlotsResult(
      { notified_count: 2, already_sent: false },
      { ok: true, failed: 0, delivered: 2, noSubscription: 0 }
    )
    expect(result.level).toBe('success')
    expect(result.message).toBe('アプリ内通知：2人へ送信完了／プッシュ通知：2件配信')
    expect(result.canRetryPush).toBe(false)
  })

  it('新規送信・Push一部が実際に配信失敗: warningレベルで、配信できた件数と失敗件数を区別して表示する（通知レコード単位の「件」。人数ではない）。配信を試みて失敗したものは二度と再送できないため、再試行は提示しない（v18レビュー対応）', () => {
    const result = describeNotifySlotsResult(
      { notified_count: 2, already_sent: false },
      { ok: true, failed: 1, delivered: 1, noSubscription: 0 }
    )
    expect(result.level).toBe('warning')
    expect(result.message).toBe('アプリ内通知：2人へ送信完了／プッシュ通知：1件配信、1件配信失敗（再送はできません）')
    expect(result.canRetryPush).toBe(false)
  })

  it('同じキャストに複数の未送信通知が残っていた場合でも、Push側の件数は「人」ではなく「件」で表示する（通知レコード数と宛先人数は別。v18レビュー対応）', () => {
    const result = describeNotifySlotsResult(
      { notified_count: 1, already_sent: false },
      { ok: true, failed: 3, delivered: 2, noSubscription: 0 }
    )
    expect(result.message).toBe('アプリ内通知：1人へ送信完了／プッシュ通知：2件配信、3件配信失敗（再送はできません）')
    expect(result.message).not.toMatch(/[0-9]+人に配信|[0-9]+人へ配信失敗/)
  })

  it('まだ配信を試みていない分が残っている（incomplete）場合: 全件成功と表示せず、再試行を提示する（v18レビュー対応・Push不具合①②）', () => {
    const result = describeNotifySlotsResult(
      { notified_count: 150, already_sent: false },
      { ok: true, failed: 0, delivered: 100, noSubscription: 0, incomplete: true }
    )
    expect(result.level).toBe('warning')
    expect(result.message).toContain('一部は未送信のまま残っています')
    expect(result.canRetryPush).toBe(true)
  })

  it('配信失敗とincompleteの両方がある場合: 再試行は提示するが、失敗分は再送できないと明記する（v18レビュー対応）', () => {
    const result = describeNotifySlotsResult(
      { notified_count: 150, already_sent: false },
      { ok: true, failed: 2, delivered: 98, noSubscription: 0, incomplete: true }
    )
    expect(result.message).toContain('2件配信失敗（再送はできません）')
    expect(result.message).toContain('一部は未送信のまま残っています')
    expect(result.canRetryPush).toBe(true)
  })

  it('端末未登録は配信失敗として数えず、「対象外」として分けて表示する（実際に配信できた人数には含めない）', () => {
    const result = describeNotifySlotsResult(
      { notified_count: 2, already_sent: false },
      { ok: true, failed: 0, delivered: 2, noSubscription: 1 }
    )
    expect(result.level).toBe('success')
    expect(result.message).toBe('アプリ内通知：2人へ送信完了／プッシュ通知：1件配信、1件は端末未登録のため対象外')
    expect(result.message).not.toMatch(/2件配信/)
    expect(result.canRetryPush).toBe(false)
  })

  it('設定不足（VAPID未設定）: リクエスト全体が失敗した場合、誤解を招く人数（「1人失敗」等）を表示しない', () => {
    const result = describeNotifySlotsResult(
      { notified_count: 2, already_sent: false },
      { ok: false, failed: 1, reason: 'vapid_not_configured' }
    )
    expect(result.level).toBe('warning')
    expect(result.message).toBe('アプリ内通知：2人へ送信完了／プッシュ通知：送信設定が未完了のため送信できません')
    expect(result.message).not.toMatch(/1人/)
    expect(result.canRetryPush).toBe(true)
  })

  it('送信回数の上限（rate_limited）: 理由に応じた文言になる', () => {
    const result = describeNotifySlotsResult(
      { notified_count: 2, already_sent: false },
      { ok: false, failed: 1, reason: 'rate_limited' }
    )
    expect(result.message).toContain('送信回数の上限に達しました')
  })

  it('原因不明のリクエスト失敗: reasonが無い場合は汎用の失敗文言になる（人数は表示しない）', () => {
    const result = describeNotifySlotsResult({ notified_count: 2, already_sent: false }, { ok: false, failed: 1 })
    expect(result.message).toBe('アプリ内通知：2人へ送信完了／プッシュ通知：送信に失敗しました')
  })

  it('直前に送信済み（already_sent）: 新規作成していないことが文面から分かり、再送できない', () => {
    const result = describeNotifySlotsResult(
      { notified_count: 2, already_sent: true },
      { ok: true, failed: 0, delivered: 2, noSubscription: 0 }
    )
    expect(result.message).toContain('直前に送信済みです（2人）')
  })

  it('メッセージは「／」区切りの1文で、アプリ内通知とプッシュ通知の結果を両方含む（別々の文を連結しただけではない）', () => {
    const result = describeNotifySlotsResult(
      { notified_count: 1, already_sent: false },
      { ok: true, failed: 1, delivered: 0, noSubscription: 0 }
    )
    expect(result.message.split('／')).toHaveLength(2)
  })
})
