import type { EfficiencyTimelineLane, EfficiencyTimelineResponse } from '../types'

const LEGEND_ITEMS: Array<{ key: EfficiencyTimelineLane['currentStateKey']; label: string; color: string; description: string }> = [
  { key: 'disconnected', label: '未工作', color: '#dadce0', description: '灰色' },
  { key: 'standby', label: '待机', color: '#eace21', description: '黄色' },
  { key: 'running', label: '测试中', color: '#2eaa4a', description: '绿色' },
  { key: 'fault', label: '报警', color: '#ca3333', description: '红色' },
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

function buildTicks(windowStart: string, windowEnd: string) {
  const start = new Date(windowStart).getTime()
  const end = new Date(windowEnd).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return []

  const ticks: { label: string; left: string }[] = []

  // 鎵惧埌绗竴涓暣鐐瑰皬鏃?
  const firstHour = new Date(start)
  firstHour.setMinutes(0, 0, 0)
  if (firstHour.getTime() < start) {
    firstHour.setHours(firstHour.getHours() + 1)
  }

  // 鐢熸垚姣忓皬鏃舵暣鐐瑰埢搴?
  let current = firstHour.getTime()
  while (current <= end) {
    const left = ((current - start) / (end - start)) * 100
    const date = new Date(current)
    const label = `${String(date.getHours()).padStart(2, '0')}:00`
    ticks.push({ label, left: `${left}%` })
    current += 60 * 60_000 // 鍔?灏忔椂
  }

  return ticks
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

  // 鍩轰簬鏃堕棿杞磋绠椾綅缃拰瀹藉害锛堢湡瀹炴瘮渚嬶紝涓嶉檺鍒舵渶灏忓搴︼級
  const left = ((start - min) / total) * 100
  const width = ((end - start) / total) * 100

  return {
    left: `${Math.max(0, Math.min(100, left))}%`,
    width: `${Math.max(0, Math.min(100, width))}%`,
  }
}

export function EfficiencyAnalysis({
  data,
  loading,
  liveStateByFaceplate,
}: {
  data: EfficiencyTimelineResponse | null
  loading: boolean
  liveStateByFaceplate?: Partial<Record<number, {
    stateKey: EfficiencyTimelineLane['currentStateKey']
    stateLabel: string
    colorHex: string
  }>>
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
            const liveState = liveStateByFaceplate?.[lane.faceplateIndex]
            const currentStateKey = liveState?.stateKey ?? lane.currentStateKey
            const currentStateLabel = liveState?.stateLabel ?? lane.currentStateLabel
            const currentColorHex = liveState?.colorHex ?? lane.currentColorHex
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
                  <span className={`efficiency-current-pill ${currentStateKey}`}>
                    <span className="efficiency-current-dot" style={{ backgroundColor: currentColorHex }} aria-hidden="true" />
                    {currentStateLabel}
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
                  <div className="efficiency-track-stack" role="img" aria-label={`${lane.stationName} 鏈€杩?12 灏忔椂鐘舵€佺敇鐗瑰浘`}>
                    {LEGEND_ITEMS.map((item) => (
                      <div key={`${lane.faceplateIndex}-${item.key}`} className={`efficiency-track-row ${item.key}`} data-label={item.label}>
                        <div className="efficiency-track" aria-hidden="true">
                          {lane.segments.map((segment, index) => {
                            if (segment.stateKey !== item.key) return null
                            const style = segmentStyle(segment.startedAt, segment.endedAt, data.windowStart, data.windowEnd)
                            const segmentStart = new Date(segment.startedAt).getTime()
                            const segmentEnd = new Date(segment.endedAt).getTime()
                            const durationMs =
                              Number.isFinite(segmentStart) && Number.isFinite(segmentEnd) && segmentEnd > segmentStart
                                ? segmentEnd - segmentStart
                                : 0
                            return (
                              <div
                                key={`${lane.faceplateIndex}-${item.key}-${index}-${segment.startedAt}`}
                                className={`efficiency-segment ${segment.stateKey}`}
                                style={{ ...style, backgroundColor: segment.colorHex }}
                                title={`${segment.stateLabel} | ${formatDateTime(segment.startedAt)} - ${formatDateTime(segment.endedAt)} | 持续: ${formatDurationText(durationMs)}`}
                              />
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

