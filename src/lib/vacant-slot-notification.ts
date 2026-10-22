export interface NotifySlotsResultDescription {
  level: 'success' | 'warning'
  message: string
  /**
   * v18レビュー対応（Push不具合②）: 「まだ配信を試みていない（push_sent_atが未設定の）
   * 通知が残っている」場合のみtrue（push.incompleteそのもの）。配信を試みた上で実際に
   * 失敗した通知（push.failed）は、仕組み上二度と再送できないため、再試行の対象にしない
   * （再試行ボタンを出さない＝"Push配信自体を再試行できる状態"だけを表す）。
   */
  canRetryPush: boolean
}

const PUSH_FAILURE_REASON_TEXT: Record<string, string> = {
  vapid_not_configured: '送信設定が未完了のため送信できません',
  rate_limited: '送信回数の上限に達しました。しばらくしてからお試しください',
}

/**
 * 「空き枠をまとめて通知」の結果（アプリ内通知の作成結果＋Push配信結果）を、1つのメッセージへまとめる。
 * アプリ内通知の成功とPush配信の失敗を別々のポップアップで即座に切り替えて表示すると、
 * 先に出た方を読み切る前に次のポップアップに変わってしまい、「送信できなかった」と誤認されて
 * 再試行（＝結果としての連打）につながる。両方の結果が揃ってから、1つのメッセージとして返す。
 *
 * Push側は、設定不足（vapid_not_configured）・送信回数の上限（rate_limited）・実際の配信失敗を
 * 区別して表示する。リクエスト自体が失敗した場合（push.ok=false）は、okWhenFailedのfailed値が
 * 実際の件数を意味しない固定値のため、件数を表示に使わない。宛先の端末登録が無かった件数
 * （noSubscription）は、実際に配信できた件数（delivered - noSubscription）には含めない。
 *
 * v18レビュー対応: delivered・failed・noSubscriptionは、いずれも「通知レコード（行）単位」の
 * 件数であり、宛先の人数（重複の無い人数）とは異なる。同じキャストに複数の未送信通知が
 * 残っている場合（pending windowをまたいだ蓄積、101件超の一括処理等）、1人に対して複数件の
 * 失敗が発生しうるため、「◯人」ではなく「◯件」と表示する（人数と取り違えない）。
 */
export function describeNotifySlotsResult(
  notify: { notified_count: number; already_sent: boolean },
  push: { ok: boolean; failed: number; delivered?: number; noSubscription?: number; reason?: string; incomplete?: boolean }
): NotifySlotsResultDescription {
  const notifyPart = notify.already_sent
    ? `アプリ内通知：直前に送信済みです（${notify.notified_count}人）`
    : `アプリ内通知：${notify.notified_count}人へ送信完了`

  if (!push.ok) {
    const reasonText = (push.reason && PUSH_FAILURE_REASON_TEXT[push.reason]) || '送信に失敗しました'
    return { level: 'warning', message: `${notifyPart}／プッシュ通知：${reasonText}`, canRetryPush: true }
  }

  const delivered = push.delivered ?? 0
  const noSubscription = push.noSubscription ?? 0
  const realDelivered = Math.max(0, delivered - noSubscription)
  const incomplete = push.incomplete === true
  const parts: string[] = []
  if (realDelivered > 0) parts.push(`${realDelivered}件配信`)
  if (noSubscription > 0) parts.push(`${noSubscription}件は端末未登録のため対象外`)
  // v18レビュー対応（Push不具合②）: 配信を試みて実際に失敗したものは、仕組み上二度と再送できない
  // ため、「再送できません」と明記し、再試行ボタン（canRetryPush）の対象にもしない。
  if (push.failed > 0) parts.push(`${push.failed}件配信失敗（再送はできません）`)
  // v18レビュー対応（Push不具合①）: まだ配信を試みていない分が残っている（incomplete）場合は、
  // 0件処理のまま「送信完了」と表示されることを防ぐため、必ず文言に反映する。
  if (incomplete) parts.push('件数が多いため一部は未送信のまま残っています（時間をおいて再度お試しください）')
  const pushText = parts.length > 0 ? parts.join('、') : '送信完了'
  const hasFailure = push.failed > 0
  return {
    level: hasFailure || incomplete ? 'warning' : 'success',
    message: `${notifyPart}／プッシュ通知：${pushText}`,
    canRetryPush: incomplete,
  }
}
