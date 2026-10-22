import type { SupabaseClient } from '@supabase/supabase-js'

// キャスト画面へ「空き枠の一覧が変わった」ことを知らせるブロードキャスト。
//
// 空き枠が非公開になった更新(UPDATE)は、キャストのRLS（公開中の枠のみ参照可）では更新後の行が見えなくなるため、
// Supabase Realtimeのpostgres_changesではキャストへ配信されない（削除・追加・公開中のままの更新は届く）。
// そこで管理者の画面が、公開/非公開を切り替えた後にこのブロードキャストを送る。
// キャスト画面は受信すると、RLSで絞られた最新の一覧を自分で再取得するだけなので、
// 第三者がこのイベントを偽装して送っても「再取得が走る」以上の影響はない（一覧の内容は信用しない）。
// ブロードキャストが届かなかった場合に備えて、キャスト画面は定期的にも再取得する。

export const vacantSlotsChannelName = (storeId: string) => `cast-vacant-slots-${storeId}`
export const VACANT_SLOTS_CHANGED_EVENT = 'vacant_slots_changed'

/** 送信は「できれば届ける」扱い。失敗しても呼び出し元の処理（公開切替の成功）には影響させない */
export async function broadcastVacantSlotsChanged(supabase: Pick<SupabaseClient, 'channel' | 'removeChannel'>, storeId: string): Promise<void> {
  try {
    const channel = supabase.channel(vacantSlotsChannelName(storeId))
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('subscribe timeout')), 5000)
      channel.subscribe(status => {
        if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve() }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { clearTimeout(timer); reject(new Error(status)) }
      })
    })
    await channel.send({ type: 'broadcast', event: VACANT_SLOTS_CHANGED_EVENT, payload: {} })
    await supabase.removeChannel(channel)
  } catch {
    // 定期再取得に任せる
  }
}
