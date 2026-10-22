import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { dispatchPush } from '@/lib/push'

// v18レビュー対応（Push不具合①）: dispatchPush()は/api/push/dispatchを1回しか呼ばないため、
// サーバー側のハード上限（100件）を超える未送信がある場合、残りが送信されないまま
// 「成功」として扱われていた。残っている間（上限まで）呼び出しを繰り返すよう変更した。
// ここではfetch自体をモックし、実際のネットワーク・サーバーには一切接続しない。

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('dispatchPush（/api/push/dispatch の呼び出しと、remainingが残っている間の繰り返し）', () => {
  it('1回の呼び出しでremaining:0なら、そのまま返す（fetchは1回だけ）', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ total: 2, delivered: 2, failed: 0, noSubscription: 0, remaining: 0 }))
    const result = await dispatchPush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true, total: 2, delivered: 2, failed: 0, noSubscription: 0, incomplete: false })
  })

  it('remainingが残っている間は呼び出しを繰り返し、合計を集計する（101件超の再現）', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ total: 100, delivered: 100, failed: 0, noSubscription: 0, remaining: 5 }))
      .mockResolvedValueOnce(jsonResponse({ total: 5, delivered: 5, failed: 0, noSubscription: 0, remaining: 0 }))
    const result = await dispatchPush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ ok: true, total: 105, delivered: 105, failed: 0, noSubscription: 0, incomplete: false })
  })

  it('remainingがnull（サーバー側で件数を確認できなかった）の場合は、0件と断定せず繰り返す', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ total: 10, delivered: 10, failed: 0, noSubscription: 0, remaining: null }))
      .mockResolvedValueOnce(jsonResponse({ total: 0, delivered: 0, failed: 0, noSubscription: 0, remaining: 0 }))
    const result = await dispatchPush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.incomplete).toBe(false)
  })

  it('イテレーション上限に達しても残っている場合は、無限ループにせず打ち切り、incomplete:trueで返す（全件成功と表示しない）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ total: 100, delivered: 100, failed: 0, noSubscription: 0, remaining: 999 }))
    const result = await dispatchPush()
    // MAX_DISPATCH_ITERATIONS(10)回で打ち切られる。無限ループにはならない
    expect(fetchMock).toHaveBeenCalledTimes(10)
    expect(result.ok).toBe(true)
    expect(result.incomplete).toBe(true)
    expect(result.total).toBe(1000)
  })

  it('1回目のリクエスト自体が失敗（HTTP非200）した場合は、従来どおりok:falseを返す', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: 'rate_limited' }, false, 429))
    const result = await dispatchPush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: false, total: 0, delivered: 0, failed: 1, noSubscription: 0, reason: 'rate_limited', incomplete: false })
  })

  it('1回目が通信エラー（例外）の場合は、従来どおりok:falseを返す', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const result = await dispatchPush()
    expect(result).toEqual({ ok: false, total: 0, delivered: 0, failed: 1, noSubscription: 0, incomplete: false })
  })

  it('1回目は成功したが2回目（残り分の取得）が失敗した場合、1回目までの集計は捨てずに保持し、ok:true・incomplete:trueで返す（全件失敗扱いにしない）', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ total: 100, delivered: 98, failed: 2, noSubscription: 0, remaining: 3 }))
      .mockResolvedValueOnce(jsonResponse({ code: 'rate_limited' }, false, 429))
    const result = await dispatchPush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.ok).toBe(true)
    expect(result.incomplete).toBe(true)
    expect(result.total).toBe(100)
    expect(result.delivered).toBe(98)
    expect(result.failed).toBe(2)
    expect(result.reason).toBe('rate_limited')
  })
})
