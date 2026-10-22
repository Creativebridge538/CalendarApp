// Web Push送信API（/api/push/dispatch）の入力・リンク検証（純粋関数。単体テスト対象）。
//
// 送信の考え方: ブラウザは宛先・タイトル・本文・リンクを指定できない。DB内の専用経路（RPC・トリガー）が
// notifications に通知を作り（宛先・文面・リンクはDBが決定、作成者 created_by を記録）、APIは
// 「呼び出し元が作成した未送信(push_sent_at is null)の通知」だけを、保存内容のまま1回だけ送る。

/** 通知のリンクとして許可するアプリ内の相対パス（DBのCHECK制約 notifications_link_allowed と同じ規則） */
const ALLOWED_LINK = /^\/(cast|admin|notifications|dashboard)(\/[A-Za-z0-9_-]+)*(\?[A-Za-z0-9_=&.%-]*)?$/

export function isAllowedNotificationLink(link: unknown): boolean {
  if (link === null || link === undefined) return true
  return typeof link === 'string' && ALLOWED_LINK.test(link)
}

/** リクエストボディが空（またはキーを持たない空オブジェクト）でなければ、任意の宛先・文面・リンクの指定とみなして拒否する */
export function hasArbitraryPayload(parsedBody: unknown): boolean {
  if (parsedBody === null || parsedBody === undefined) return false
  if (typeof parsedBody !== 'object' || Array.isArray(parsedBody)) return true
  return Object.keys(parsedBody as Record<string, unknown>).length > 0
}

/** 1回のリクエストで送る通知の最大件数 */
export const MAX_DISPATCH_PER_REQUEST = 100
/** 呼び出し元あたり、直近1分間に送信できる通知の上限（連続送信の抑止） */
export const MAX_PUSH_PER_MINUTE = 200
/** 未送信の通知を送れる期間（作成からの分数）。古い通知を後から一括送信させない */
export const PENDING_WINDOW_MINUTES = 15

export interface OperationPushResultDescription {
  level: 'success' | 'warning'
  message: string
}

const PUSH_FAILURE_REASON_TEXT: Record<string, string> = {
  vapid_not_configured: 'プッシュ通知の送信設定が未完了のため送信できません',
  rate_limited: 'プッシュ通知の送信回数の上限に達しました。しばらくしてからお試しください',
}

/**
 * 業務処理（DB操作）は既に成功しており、その結果メッセージ(successMessage)とPush配信の結果を、
 * 1つのメッセージへまとめる（成功とPush失敗を別々のポップアップで連続表示すると、先に出た方を
 * 読み切る前に変わってしまい「処理できなかった」と誤認されうるため）。
 * - Push配信のリクエスト自体が失敗した場合（push.ok=false）は、failedの値が実際の件数を意味しない
 *   固定値のため、件数を表示に使わず理由別の文言にする。
 * - 宛先の端末登録が無かった件数（noSubscription）は、配信の失敗とは区別し、実際の配信失敗
 *   （failed）には含めない。
 * - 業務処理自体が失敗した場合はこの関数を呼ばない（呼び出し元が早期returnし、成功表示を出さない）。
 * - v18レビュー対応: failed・noSubscriptionは通知レコード単位の件数であり、宛先の人数とは
 *   異なる（同じ宛先に複数の未送信通知が残っている場合、1人で複数件になりうる）。「◯人」ではなく
 *   「◯件」と表示する。
 */
export function describeOperationPushResult(
  successMessage: string,
  push: { ok: boolean; failed: number; noSubscription?: number; reason?: string; incomplete?: boolean }
): OperationPushResultDescription {
  if (!push.ok) {
    const reasonText = (push.reason && PUSH_FAILURE_REASON_TEXT[push.reason]) || 'プッシュ通知の送信に失敗しました'
    return { level: 'warning', message: `${successMessage}（${reasonText}）` }
  }
  const noSubscription = push.noSubscription ?? 0
  const incomplete = push.incomplete === true
  if (push.failed === 0 && noSubscription === 0 && !incomplete) return { level: 'success', message: successMessage }
  const parts: string[] = []
  // v18レビュー対応（Push不具合②）: 配信を試みて失敗したものは再送できないため明記する
  if (push.failed > 0) parts.push(`${push.failed}件のプッシュ通知の送信に失敗しました（再送はできません）`)
  if (noSubscription > 0) parts.push(`${noSubscription}件は端末未登録のためプッシュ通知の対象外でした`)
  // v18レビュー対応（Push不具合①）: 残件がある0件処理を「成功」と表示しない
  if (incomplete) parts.push('件数が多いため一部は未送信のまま残っています（時間をおいて再度お試しください）')
  return { level: (push.failed > 0 || incomplete) ? 'warning' : 'success', message: `${successMessage}（${parts.join('、')}）` }
}

export interface PushResultDescription {
  level: 'error' | 'success'
  message: string
  /** toastの表示時間（ms）。省略時は呼び出し元の既定値を使う */
  duration?: number
}

/**
 * dispatchPush()の結果を、宛先ラベル・自分宛かどうかに応じたユーザー向けメッセージへ変換する（純粋関数）。
 * トーストの表示自体は行わない（呼び出し元がlevel/message/durationを見て表示する）。
 */
export function describePushDispatchResult(
  result: { ok: boolean; failed: number; noSubscription: number; incomplete?: boolean },
  targetLabel: string,
  isSelf: boolean
): PushResultDescription {
  if (!result.ok) {
    return { level: 'error', message: `${targetLabel}へのプッシュ送信に失敗しました（通知はアプリ内に作成済みです）` }
  }
  if (result.failed > 0) {
    // v18レビュー対応（Push不具合②）: 配信を試みて失敗したものは再送できないため明記する
    return { level: 'error', message: `${targetLabel}へのプッシュ送信に失敗しました（通知はアプリ内に作成済みです。再送はできません）`, duration: 15000 }
  }
  if (result.incomplete) {
    // v18レビュー対応（Push不具合①）: 残件がある0件処理を「成功」と表示しない
    return { level: 'error', message: `${targetLabel}へのプッシュ送信が完了していません（件数が多いため一部未送信です。時間をおいて再度お試しください）`, duration: 15000 }
  }
  if (result.noSubscription > 0) {
    // 端末側は「オン」表示でもサーバーに登録が残っていないケース（VAPID鍵の更新などで発生）。
    // 「端末で通知をオンにしてるか確認して」だと画面上すでにオンに見えて混乱するため、再登録を促す
    return {
      level: 'error',
      message: isSelf
        ? 'プッシュ通知の登録がサーバーに見つかりません。下の「オフにする」→「オンにする」を押し直して登録し直してください'
        : `${targetLabel}のプッシュ通知の登録がサーバーに見つかりません。本人の端末で通知を一度「オフ」→「オン」にして登録し直してもらってください`,
      duration: 15000,
    }
  }
  return { level: 'success', message: `${targetLabel}へテスト通知を送信しました（プッシュ送信済み）` }
}
