import type { EfficiencyTimelineLane, EfficiencyTimelineResponse } from '../types'

const LEGEND_ITEMS: Array<{ key: Exclude<EfficiencyTimelineLane['currentStateKey'], 'disconnected'>; label: string; color: string; description: string }> = [
  { key: 'standby', label: '待机', color: '#fbbc04', description: '黄色' },
  { key: 'running', label: '测试中', color: '#34a853', description: '绿色' },
  { key: 'fault', label: '报警处理', color: '#ea4335', description: '红色' },
]

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatHourMinute(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '--:--'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function buildTicks(windowStart: string, windowEnd: string) {
  const start = new Date(windowStart).getTime()
  const end = new Date(windowEnd).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return []

  return Array.from({ length: 13 }, (_, index) => {
    const ts = start + ((end - start) * index) / 12
    return {
      label: formatHourMinute(new Date(ts).toISOString()),
      left: `${(index / 12) * 100}%`,
    }
  })
}

function formatDurationText(durationMs: number) {
  const hours = durationMs / 3_600_000
  return hours >= 1 ? `${hours.toFixed(1)} h` : `${Math.round(durationMs / 60_000)} min`
}

function buildSummary(lane: EfficiencyTimelineLane) {
  const totals = new Map<string, number>()
  for (const segment of lane.segments) {
    const start = new Date(segment.startedAt).getTime()
    const end = new Date(segment.endedAt).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    totals.set(segment.stateKey, (totals.get(segment.stateKey) ?? 0) + (end - start))
  }

  const summaryItems = LEGEND_ITEMS.map((item) => {
    const durationMs = totals.get(item.key) ?? 0
    return {
      key: item.key,
      label: item.label,
      durationText: formatDurationText(durationMs),
    }
  })

  const standbyMs = totals.get('standby') ?? 0
  const runningMs = totals.get('running') ?? 0
  const faultMs = totals.get('fault') ?? 0
  const oeeBaseMs = standbyMs + runningMs + faultMs
  const oeeText = oeeBaseMs > 0 ? `${((runningMs / oeeBaseMs) * 100).toFixed(1)}%` : '-'

  return [
    ...summaryItems,
    {
      key: 'oee',
      label: 'OEE',
      durationText: oeeText,
    },
  ]
}


function segmentStyle(segmentStart: string, segmentEnd: string, windowStart: string, windowEnd: string) {
  const start = new Date(segmentStart).getTime()
  const end = new Date(segmentEnd).getTime()
  const min = new Date(windowStart).getTime()
  const max = new Date(windowEnd).getTime()
  const total = max - min

  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(min) || !Number.isFinite(max) || total <= 0) {
    return { left: '0%', width: '0%' }
  }

  const left = ((start - min) / total) * 100
  const width = Math.max(((end - start) / total) * 100, 0.75)
  return {
    left: `${Math.max(0, left)}%`,
    width: `${Math.min(100 - Math.max(0, left), width)}%`,
  }
}

export function EfficiencyAnalysis({
  data,
  loading,
}: {
  data: EfficiencyTimelineResponse | null
  loading: boolean
}) {
  const ticks = data ? buildTicks(data.windowStart, data.windowEnd) : []

  return (
    <section className="efficiency-page">
      {!data ? (
        <div className="efficiency-empty">{loading ? '效率分析加载中…' : '暂无效率分析数据'}</div>
      ) : (
        <div className="efficiency-grid">
          {data.lanes.map((lane) => {
            const summary = buildSummary(lane)
            const hasDemoData = lane.segments.some((segment) => segment.isDemo)
            return (
              <article key={lane.faceplateIndex} className="efficiency-card">
                <header className="efficiency-card-head">
                  <div className="efficiency-card-head-left">
                    <div>
                      <div className="efficiency-card-title">{lane.stationName}</div>
                    </div>
                    <div className="efficiency-summary-inline">
                      {summary.map((item) => (
                        <div key={`${lane.faceplateIndex}-${item.key}`} className={`efficiency-summary-chip ${item.key}`}>
                          <span>{item.label}</span>
                          <strong>{item.durationText}</strong>
                        </div>
                      ))}
                    </div>
                  </div>
                  <span className={`efficiency-current-pill ${lane.currentStateKey}`}>
                    <span className="efficiency-current-dot" style={{ backgroundColor: lane.currentColorHex }} aria-hidden="true" />
                    {lane.currentStateLabel}
                  </span>
                </header>

                <div className="efficiency-gantt-shell">
                  <div className="efficiency-axis" aria-hidden="true">
                    {ticks.map((tick) => (
                      <div key={`${lane.faceplateIndex}-${tick.label}-${tick.left}`} className="efficiency-axis-tick" style={{ left: tick.left }}>
                        <span>{tick.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="efficiency-track-stack" role="img" aria-label={`${lane.stationName} 最近 24 小时状态甘特图`}>
                    {LEGEND_ITEMS.map((item) => (
                      <div key={`${lane.faceplateIndex}-${item.key}`} className={`efficiency-track-row ${item.key}`} data-label={item.label}>
                        <div className="efficiency-track" aria-hidden="true">
                          {lane.segments.map((segment, index) => {
                            if (segment.stateKey !== item.key) return null
                            const style = segmentStyle(segment.startedAt, segment.endedAt, data.windowStart, data.windowEnd)
                            return (
                              <div
                                key={`${lane.faceplateIndex}-${item.key}-${index}-${segment.startedAt}`}
                                className={`efficiency-segment ${segment.stateKey}`}
                                style={{ ...style, backgroundColor: segment.colorHex }}
                                title={`${segment.stateLabel}｜${formatDateTime(segment.startedAt)} - ${formatDateTime(segment.endedAt)}`}
                              />
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>


                <div className="efficiency-card-foot">
                  <span>{hasDemoData ? '当前为前端仿真变量，用于测试甘特图动态刷新效果。' : '当前时间轴来自实际变量采集。'}</span>

                  <span>更新时间：{formatDateTime(data.generatedAt)}</span>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
