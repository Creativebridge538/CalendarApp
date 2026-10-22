import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// /api/push/dispatch のルートハンドラを、Supabaseクライアントを故障注入できるモックで検証する。
// 目的: DBの取得・更新に失敗した場合に「対象0件・成功」を返していないか（失敗を隠していないか）、
// 確保(push_sent_at設定)後・送信試行前の失敗で通知が「送信済み扱いのまま」消えないか（確保を解除するか）、
// 連続送信の抑止と確保(claim_pending_push_notifications)がDB関数呼び出し1回であることを確認する。
// 実際のSupabase/ネットワークへは一切接続しない（純粋なユニットテスト。ローカルSupabaseも不要）。

type QueueItem = { data?: unknown; error?: unknown; count?: number | null }
type LogEntry = { table: string; op: string; payload?: unknown; ids?: unknown }

function makeQueueBuilder(queue: QueueItem[], log: LogEntry[], table: string) {
  const entry: { op?: string; payload?: unknown; ids?: unknown } = {}
  const resolve = () => {
    const item = queue.shift() ?? { data: null, error: null }
    log.push({ table, op: entry.op ?? 'select', payload: entry.payload, ids: entry.ids })
    return item
  }
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    gte: () => builder,
    in: (_col: string, ids: unknown) => { entry.ids = ids; return builder },
    update: (payload: unknown) => { entry.op = 'update'; entry.payload = payload; return builder },
    delete: () => { entry.op = 'delete'; return builder },
    then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(onFulfilled, onRejected),
  }
  return builder
}

const VAPID_ENV = { VAPID_SUBJECT: 'mailto:test@example.com', NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' }

let meResponse: { data: unknown; error: unknown }
let claimResponse: { data: unknown; error: unknown }
let claimArgs: unknown
let adminQueue: QueueItem[]
let adminLog: LogEntry[]
let sendNotificationMock: (...args: unknown[]) => Promise<unknown>

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } } as never) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => meResponse }) }) }),
  }),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => makeQueueBuilder(adminQueue, adminLog, table),
    // claim_pending_push_notifications は service_role 専用（authenticatedにEXECUTEが無い）ため、
    // ユーザーのセッション(supabase/server)ではなく admin client（service_role）側から呼ばれる
    rpc: async (_name: string, args: unknown) => { claimArgs = args; return claimResponse },
  }),
}))
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: (...args: unknown[]) => sendNotificationMock(...args),
  },
}))

const OLD_ENV = process.env

beforeEach(() => {
  process.env = { ...OLD_ENV, ...VAPID_ENV }
  meResponse = { data: { store_id: 'store-1' }, error: null }
  claimResponse = { data: [], error: null }
  claimArgs = undefined
  adminQueue = []
  adminLog = []
  sendNotificationMock = vi.fn(async () => ({}))
})
afterEach(() => { process.env = OLD_ENV; vi.clearAllMocks() })

async function callDispatch() {
  const { POST } = await import('@/app/api/push/dispatch/route')
  const res = await POST(new Request('http://localhost/api/push/dispatch', { method: 'POST' }))
  const json = await res.json()
  return { status: res.status, json }
}

const claimedNotification = { id: 'n1', user_id: 'cast-1', store_id: 'store-1', title: 't', body: 'b', link: null }

describe('/api/push/dispatch: DB取得・更新の各errorを確認する（成功を偽装しない）', () => {
  it('自分の店舗の確認(users)取得に失敗したら500（403「権限がありません」にすり替えない）', async () => {
    meResponse = { data: null, error: { message: 'db down' } }
    const { status, json } = await callDispatch()
    expect(status).toBe(500)
    expect(json.error).not.toMatch(/権限がありません/)
  })

  it('確認と確保(claim_pending_push_notifications)は1回のDB関数呼び出しで、認証済みユーザーのIDと上限値をサーバー側から渡している（admin client=service_role経由）', async () => {
    claimResponse = { data: [], error: null }
    await callDispatch()
    expect(claimArgs).toMatchObject({
      p_user_id: 'user-1',
      p_max_per_minute: expect.any(Number), p_pending_window_minutes: expect.any(Number), p_max_batch: expect.any(Number),
    })
  })

  it('連続送信の抑止（claim_pending_push_notificationsがerrcode 23514を返す）は429を返す。黙って0件成功扱いにしない', async () => {
    claimResponse = { data: null, error: { code: '23514', message: '送信が多すぎます。しばらくしてからお試しください' } }
    const { status, json } = await callDispatch()
    expect(status).toBe(429)
    expect(json).not.toMatchObject({ total: 0, delivered: 0, failed: 0, noSubscription: 0 })
  })

  it('claim_pending_push_notificationsがその他のエラーを返したら500を返す。{total:0,...}の200で成功扱いにしない', async () => {
    claimResponse = { data: null, error: { code: '58000', message: 'db down' } }
    const { status, json } = await callDispatch()
    expect(status).toBe(500)
    expect(json).not.toMatchObject({ total: 0, delivered: 0, failed: 0, noSubscription: 0 })
  })

  it('claim_pending_push_notificationsが0件を返したら、対象0件・成功（送信を試みない）', async () => {
    claimResponse = { data: [], error: null }
    const { status, json } = await callDispatch()
    expect(status).toBe(200)
    expect(json).toMatchObject({ total: 0, delivered: 0, failed: 0, noSubscription: 0 })
    expect(sendNotificationMock).not.toHaveBeenCalled()
  })

  it('確保(claim)後・送信試行前の購読取得に失敗したら、確保済みの通知を確保解除(push_sent_at=null)してから失敗として返す（送信済み扱いのまま消えない）', async () => {
    claimResponse = { data: [claimedNotification], error: null }
    adminQueue = [
      { data: null, error: { message: 'db down' } }, // subscriptions
    ]
    const { status } = await callDispatch()
    expect(status).toBe(500)
    // subscriptions取得の失敗直後に、確保していた通知(n1)を確保解除するUPDATEが呼ばれている
    const unclaim = adminLog.find(l => l.table === 'notifications' && l.op === 'update' && (l.payload as { push_sent_at?: unknown })?.push_sent_at === null)
    expect(unclaim).toBeDefined()
    expect(unclaim?.ids).toEqual(['n1'])
    // Push送信自体（webpush.sendNotification）は一度も試みられていない
    expect(sendNotificationMock).not.toHaveBeenCalled()
  })

  it('未読件数(バッジ用)の取得に失敗しても、送信自体は中断せず処理が続く（付随情報のみのため、失敗を丸ごと隠さず送信は続行しフォールバック値を使う）', async () => {
    claimResponse = { data: [claimedNotification], error: null }
    adminQueue = [
      { data: [{ id: 'sub1', user_id: 'cast-1', endpoint: 'https://example.com/x', p256dh: 'k', auth: 'a' }], error: null }, // subscriptions
      { count: null, error: { message: 'db down' } }, // unread count
    ]
    const { status, json } = await callDispatch()
    expect(status).toBe(200)
    expect(sendNotificationMock).toHaveBeenCalledTimes(1)
    expect(json.delivered).toBe(1)
  })

  it('失効購読の削除(stale cleanup)に失敗しても、今回の送信結果自体は正しく返す', async () => {
    sendNotificationMock = vi.fn(async () => { const e = new Error('gone') as Error & { statusCode: number }; e.statusCode = 410; throw e })
    claimResponse = { data: [claimedNotification], error: null }
    adminQueue = [
      { data: [{ id: 'sub1', user_id: 'cast-1', endpoint: 'https://example.com/x', p256dh: 'k', auth: 'a' }], error: null }, // subscriptions
      { count: 0, error: null }, // unread count
      { data: null, error: { message: 'db down' } }, // stale delete
    ]
    const { status, json } = await callDispatch()
    expect(status).toBe(200)
    expect(json.failed).toBe(1)
    expect(json.delivered).toBe(0)
  })

  it('正常系: すべて成功すれば200で配信済み件数が返る（回帰確認）', async () => {
    claimResponse = { data: [claimedNotification], error: null }
    adminQueue = [
      { data: [{ id: 'sub1', user_id: 'cast-1', endpoint: 'https://example.com/x', p256dh: 'k', auth: 'a' }], error: null }, // subscriptions
      { count: 0, error: null }, // unread count
    ]
    const { status, json } = await callDispatch()
    expect(status).toBe(200)
    expect(json).toMatchObject({ total: 1, delivered: 1, failed: 0, noSubscription: 0 })
    expect(sendNotificationMock).toHaveBeenCalledTimes(1)
  })
})

// v18レビュー対応（Push不具合①）: 1回のdispatchで処理できるのは最大100件（DB側のハード上限）。
// 101件以上が未送信のまま残っている場合に、呼び出し元（dispatchPush()）が「まだ残っているか」を
// 知れるようにするため、レスポンスに remaining（push_sent_at未設定の件数。pending windowの
// 期限切れで二度とclaimされなくなったものも含む）を追加した。
describe('/api/push/dispatch: remaining（まだpush_sent_at未設定の件数）の算出', () => {
  it('処理後もpush_sent_at未設定の通知が残っていれば、その件数をremainingとして返す', async () => {
    claimResponse = { data: [claimedNotification], error: null }
    adminQueue = [
      { data: [{ id: 'sub1', user_id: 'cast-1', endpoint: 'https://example.com/x', p256dh: 'k', auth: 'a' }], error: null }, // subscriptions
      { count: 0, error: null }, // unread count
      { count: 5, error: null }, // remaining count（まだ5件残っている想定）
    ]
    const { json } = await callDispatch()
    expect(json.remaining).toBe(5)
  })

  it('remainingの集計自体が失敗した場合は、0件と断定せずnullを返す（「残っていないはず」と決めつけない）', async () => {
    claimResponse = { data: [claimedNotification], error: null }
    adminQueue = [
      { data: [{ id: 'sub1', user_id: 'cast-1', endpoint: 'https://example.com/x', p256dh: 'k', auth: 'a' }], error: null }, // subscriptions
      { count: 0, error: null }, // unread count
      { count: null, error: { message: 'db down' } }, // remaining count 取得失敗
    ]
    const { json } = await callDispatch()
    expect(json.remaining).toBeNull()
  })

  it('claimが0件（早期return）の場合も、remainingを算出して返す', async () => {
    claimResponse = { data: [], error: null }
    adminQueue = [
      { count: 0, error: null }, // remaining count
    ]
    const { json } = await callDispatch()
    expect(json).toMatchObject({ total: 0, delivered: 0, failed: 0, noSubscription: 0, remaining: 0 })
  })
})
