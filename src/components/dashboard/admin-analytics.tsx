'use client'

import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { ja } from 'date-fns/locale'
import { Calendar, FileEdit, Users, TrendingUp, TrendingDown, Minus, Trophy, Wallet, Briefcase } from 'lucide-react'

interface TodayShift {
  id: string
  castName: string
  startTime: string
  endTime: string
  roomName: string | null
}

interface Props {
  pendingShifts: number
  pendingRequests: number
  pendingVacantApplications: number
  todayShifts: TodayShift[]
  todayLabel: string
  totalThisMonth: number
  totalPrevMonth: number
  trend: { date: string; amount: number }[]
  castRanking: { name: string; amount: number }[]
  weekday: { label: string; amount: number }[]
  activeCastCount: number
  avgDailySales: number
}

function useCountUp(target: number, durationMs = 900) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    let raf: number
    const start = performance.now()
    const from = 0
    function tick(now: number) {
      const t = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(from + (target - from) * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, durationMs])
  return value
}

function StatTile({
  icon: Icon, label, value, prefix, sub, delay,
}: { icon: typeof Calendar; label: string; value: number; prefix?: string; sub: string; delay: number }) {
  const animated = useCountUp(value)
  return (
    <div className="stat-tile" style={{ animationDelay: `${delay}ms` }}>
      <div className="stat-tile-head">
        <span className="stat-tile-label">{label}</span>
        <Icon className="stat-tile-icon" />
      </div>
      <div className="stat-tile-value">{prefix}{animated.toLocaleString()}</div>
      <p className="stat-tile-sub">{sub}</p>
    </div>
  )
}

export function AdminAnalytics({
  pendingShifts, pendingRequests, pendingVacantApplications, todayShifts, todayLabel,
  totalThisMonth, totalPrevMonth, trend, castRanking, weekday,
  activeCastCount, avgDailySales,
}: Props) {
  const delta = totalPrevMonth > 0 ? ((totalThisMonth - totalPrevMonth) / totalPrevMonth) * 100 : null
  const animatedTotal = useCountUp(totalThisMonth, 1100)

  return (
    <div className="admin-analytics">
      <style>{`
        .admin-analytics {
          --surface-page: var(--background);
          --surface-card: var(--card);
          --surface-card-hover: var(--accent);
          --ink-primary: var(--foreground);
          --ink-secondary: color-mix(in oklab, var(--foreground) 72%, var(--muted-foreground));
          --ink-muted: var(--muted-foreground);
          --gridline: color-mix(in oklab, var(--foreground) 8%, transparent);
          --baseline: color-mix(in oklab, var(--foreground) 18%, transparent);
          --line-border: var(--border);
          --series-blue: var(--primary);
          --series-aqua: #1baf7a;
          --series-violet: #9085e9;
          --status-good: #0ca30c;
          --status-critical: #d03b3b;
          background: var(--surface-page);
          color: var(--ink-primary);
          min-height: 100%;
          padding: 24px;
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        }
        @media (min-width: 768px) { .admin-analytics { padding: 32px; } }

        .aa-head { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 22px; }
        .aa-title { font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
        .aa-subtitle { font-size: 12px; color: var(--ink-muted); font-variant-numeric: tabular-nums; }

        @keyframes aa-rise {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .aa-animate { animation: aa-rise 0.45s cubic-bezier(0.16, 1, 0.3, 1) both; }

        .stat-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-bottom: 14px; }
        @media (min-width: 768px) { .stat-grid { grid-template-columns: repeat(6, 1fr); gap: 12px; } }

        .stat-tile {
          background: var(--surface-card);
          border: 1px solid var(--line-border);
          border-radius: 12px;
          padding: 14px 16px;
          animation: aa-rise 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
          transition: background-color .15s, transform .15s;
        }
        .stat-tile:hover { background: var(--surface-card-hover); transform: translateY(-1px); }
        .stat-tile-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; }
        .stat-tile-label { font-size: 11px; color: var(--ink-muted); letter-spacing: 0.01em; }
        .stat-tile-icon { width: 14px; height: 14px; color: var(--ink-muted); }
        .stat-tile-value { font-size: 22px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
        .stat-tile-sub { font-size: 10.5px; color: var(--ink-muted); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .hero-card {
          background: linear-gradient(150deg, var(--surface-card), color-mix(in oklab, var(--surface-card) 80%, var(--primary) 8%));
          border: 1px solid var(--line-border);
          border-radius: 16px;
          padding: 20px 22px;
          margin-bottom: 14px;
          animation: aa-rise 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
          display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap;
        }
        .hero-label { font-size: 11.5px; color: var(--ink-muted); margin-bottom: 6px; letter-spacing: 0.02em; }
        .hero-row { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
        .hero-value { font-size: 34px; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
        .hero-delta { display: inline-flex; align-items: center; gap: 4px; font-size: 12.5px; font-weight: 600; padding: 3px 8px; border-radius: 999px; }
        .hero-delta.good { color: var(--status-good); background: color-mix(in oklab, var(--status-good) 16%, transparent); }
        .hero-delta.bad { color: var(--status-critical); background: color-mix(in oklab, var(--status-critical) 16%, transparent); }
        .hero-delta.flat { color: var(--ink-muted); background: color-mix(in oklab, var(--foreground) 6%, transparent); }
        .hero-delta svg { width: 12px; height: 12px; }
        .hero-spark { flex-shrink: 0; width: 160px; }

        .chart-grid { display: grid; grid-template-columns: 1fr; gap: 12px; margin-bottom: 12px; }
        @media (min-width: 1024px) { .chart-grid { grid-template-columns: 1.6fr 1fr; } }

        .panel {
          background: var(--surface-card);
          border: 1px solid var(--line-border);
          border-radius: 14px;
          padding: 16px 18px;
          animation: aa-rise 0.45s cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        .panel-title { font-size: 13px; font-weight: 600; margin-bottom: 2px; }
        .panel-sub { font-size: 10.5px; color: var(--ink-muted); margin-bottom: 12px; }

        .rank-row { display: flex; align-items: center; gap: 10px; padding: 6px; border-radius: 8px; transition: background-color .12s; }
        .rank-row:hover { background: var(--surface-card-hover); }
        .rank-medal { width: 18px; font-size: 11px; color: var(--ink-muted); font-variant-numeric: tabular-nums; flex-shrink: 0; }
        .rank-name { font-size: 12px; width: 60px; flex-shrink: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rank-bar-track { flex: 1; height: 7px; background: var(--gridline); border-radius: 999px; overflow: hidden; }
        .rank-bar-fill { height: 100%; background: var(--series-aqua); border-radius: 999px; transition: width .6s cubic-bezier(0.16, 1, 0.3, 1); }
        .rank-value { font-size: 11.5px; color: var(--ink-secondary); font-variant-numeric: tabular-nums; width: 64px; text-align: right; flex-shrink: 0; }

        .today-row { display: flex; align-items: center; justify-content: space-between; padding: 9px 0; border-bottom: 1px solid var(--gridline); }
        .today-row:last-child { border-bottom: none; }
        .today-name { font-size: 12.5px; font-weight: 600; }
        .today-time { font-size: 10.5px; color: var(--ink-muted); margin-top: 1px; font-variant-numeric: tabular-nums; }
        .today-badge { font-size: 10.5px; padding: 3px 8px; border-radius: 999px; background: color-mix(in oklab, var(--status-good) 16%, transparent); color: var(--status-good); font-weight: 600; }

        .tooltip-box {
          position: absolute; pointer-events: none; background: var(--popover); border: 1px solid var(--line-border);
          border-radius: 8px; padding: 6px 10px; font-size: 11px; white-space: nowrap; transform: translate(-50%, -120%);
          box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        }
        .tooltip-date { color: var(--ink-muted); margin-bottom: 2px; }
        .tooltip-amount { font-weight: 700; font-variant-numeric: tabular-nums; }
      `}</style>

      <div className="aa-head aa-animate">
        <h1 className="aa-title">ダッシュボード</h1>
        <span className="aa-subtitle">{format(new Date(), 'yyyy.MM.dd (E)', { locale: ja })}</span>
      </div>

      <div className="hero-card" style={{ animationDelay: '40ms' }}>
        <div>
          <p className="hero-label">今月の売上合計</p>
          <div className="hero-row">
            <span className="hero-value">¥{animatedTotal.toLocaleString()}</span>
            {delta != null && (
              <span className={`hero-delta ${delta > 0.5 ? 'good' : delta < -0.5 ? 'bad' : 'flat'}`}>
                {delta > 0.5 ? <TrendingUp /> : delta < -0.5 ? <TrendingDown /> : <Minus />}
                {Math.abs(delta).toFixed(1)}%（先月比）
              </span>
            )}
          </div>
        </div>
        <div className="hero-spark">
          <Sparkline data={trend.map(t => t.amount)} />
        </div>
      </div>

      <div className="stat-grid">
        <StatTile icon={Wallet} label="平均1日売上" value={avgDailySales} prefix="¥" sub="今月・日割り" delay={60} />
        <StatTile icon={Users} label="稼働キャスト" value={activeCastCount} sub="今月・実績あり" delay={90} />
        <StatTile icon={Calendar} label="未確定シフト" value={pendingShifts} sub="要確認" delay={120} />
        <StatTile icon={FileEdit} label="修正申請" value={pendingRequests} sub="未処理" delay={150} />
        <StatTile icon={Briefcase} label="空き枠申請" value={pendingVacantApplications} sub="未処理" delay={165} />
        <StatTile icon={Trophy} label="トップキャスト" value={castRanking[0]?.amount ?? 0} prefix="¥" sub={castRanking[0]?.name ?? '—'} delay={180} />
      </div>

      <div className="chart-grid">
        <TrendChart data={trend} />
        <div className="panel" style={{ animationDelay: '160ms' }}>
          <p className="panel-title">キャスト別売上ランキング</p>
          <p className="panel-sub">今月</p>
          {castRanking.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--ink-muted)', textAlign: 'center', padding: '24px 0' }}>データがありません</p>
          ) : (
            <div>
              {castRanking.map((c, i) => {
                const max = castRanking[0]?.amount || 1
                return (
                  <div className="rank-row" key={c.name + i}>
                    <span className="rank-medal">{i + 1}</span>
                    <span className="rank-name">{c.name}</span>
                    <span className="rank-bar-track">
                      <span className="rank-bar-fill" style={{ width: `${Math.max(4, (c.amount / max) * 100)}%` }} />
                    </span>
                    <span className="rank-value">¥{c.amount.toLocaleString()}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <div className="chart-grid">
        <WeekdayChart data={weekday} />
        <div className="panel" style={{ animationDelay: '240ms' }}>
          <p className="panel-title">本日のシフト</p>
          <p className="panel-sub">{todayLabel}</p>
          {todayShifts.length === 0 ? (
            <p style={{ fontSize: 12, color: 'var(--ink-muted)', textAlign: 'center', padding: '24px 0' }}>本日のシフトはありません</p>
          ) : (
            <div>
              {todayShifts.map(s => (
                <div className="today-row" key={s.id}>
                  <div>
                    <p className="today-name">{s.castName}</p>
                    <p className="today-time">{s.startTime} 〜 {s.endTime}{s.roomName && ` ／ ${s.roomName}`}</p>
                  </div>
                  <span className="today-badge">確定</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Sparkline({ data }: { data: number[] }) {
  const width = 160
  const height = 40
  const max = Math.max(1, ...data)
  const min = Math.min(...data)
  const range = Math.max(1, max - min)
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width
    const y = height - ((v - min) / range) * (height - 4) - 2
    return { x, y }
  })
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <path d={path} fill="none" stroke="var(--series-blue)" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
      {last && <circle cx={last.x} cy={last.y} r={2.5} fill="var(--series-blue)" />}
    </svg>
  )
}

function TrendChart({ data }: { data: { date: string; amount: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const width = 640
  const height = 220
  const padTop = 12
  const padBottom = 24
  const padLeft = 8
  const padRight = 8
  const max = Math.max(1, ...data.map(d => d.amount))

  const points = data.map((d, i) => {
    const x = padLeft + (i / (data.length - 1)) * (width - padLeft - padRight)
    const y = padTop + (1 - d.amount / max) * (height - padTop - padBottom)
    return { x, y, ...d }
  })

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${height - padBottom} L${points[0].x.toFixed(1)},${height - padBottom} Z`

  function handleMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const relX = ((e.clientX - rect.left) / rect.width) * width
    let nearest = 0
    let best = Infinity
    points.forEach((p, i) => {
      const dist = Math.abs(p.x - relX)
      if (dist < best) { best = dist; nearest = i }
    })
    setHover(nearest)
  }

  const hovered = hover != null ? points[hover] : null

  return (
    <div className="panel" style={{ animationDelay: '120ms', position: 'relative' }}>
      <p className="panel-title">売上推移</p>
      <p className="panel-sub">直近30日</p>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block', cursor: 'crosshair' }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="aa-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--series-blue)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--series-blue)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map(f => (
          <line
            key={f}
            x1={padLeft} x2={width - padRight}
            y1={padTop + f * (height - padTop - padBottom)}
            y2={padTop + f * (height - padTop - padBottom)}
            stroke="var(--gridline)" strokeWidth={1}
          />
        ))}
        <path d={areaPath} fill="url(#aa-trend-fill)" stroke="none" />
        <path
          d={linePath} fill="none" stroke="var(--series-blue)" strokeWidth={2}
          strokeLinecap="round" strokeLinejoin="round"
          pathLength={1} style={{ strokeDasharray: 1, strokeDashoffset: 0, animation: 'aa-draw 1.1s cubic-bezier(0.16,1,0.3,1) both' }}
        />
        {hovered && (
          <>
            <line x1={hovered.x} x2={hovered.x} y1={padTop} y2={height - padBottom} stroke="var(--baseline)" strokeWidth={1} />
            <circle cx={hovered.x} cy={hovered.y} r={4.5} fill="var(--series-blue)" stroke="var(--surface-card)" strokeWidth={2} />
          </>
        )}
      </svg>
      {hovered && (
        <div className="tooltip-box" style={{ left: `${(hovered.x / width) * 100}%`, top: `${(hovered.y / height) * 100}%` }}>
          <div className="tooltip-date">{format(new Date(`${hovered.date}T00:00:00`), 'M/d(E)', { locale: ja })}</div>
          <div className="tooltip-amount">¥{hovered.amount.toLocaleString()}</div>
        </div>
      )}
      <style>{`@keyframes aa-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }`}</style>
    </div>
  )
}

function WeekdayChart({ data }: { data: { label: string; amount: number }[] }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...data.map(d => d.amount))
  return (
    <div className="panel" style={{ animationDelay: '280ms' }}>
      <p className="panel-title">曜日別 平均売上</p>
      <p className="panel-sub">直近60日の平均（時間帯データが無いため曜日単位で集計）</p>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 140, marginTop: 8 }}>
        {data.map((d, i) => {
          const h = Math.max(3, (d.amount / max) * 110)
          const isHover = hover === i
          return (
            <div
              key={d.label}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <span style={{ fontSize: 10, color: isHover ? 'var(--ink-primary)' : 'var(--ink-muted)', marginBottom: 4, fontVariantNumeric: 'tabular-nums' }}>
                {d.amount > 0 ? Math.round(d.amount / 1000) + 'k' : ''}
              </span>
              <div
                style={{
                  width: '100%', height: h, borderRadius: '4px 4px 2px 2px',
                  background: isHover ? 'var(--series-violet)' : 'color-mix(in oklab, var(--series-violet) 55%, transparent)',
                  transition: 'height .5s cubic-bezier(0.16,1,0.3,1), background-color .15s',
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--ink-secondary)', marginTop: 6 }}>{d.label}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
