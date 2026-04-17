import { useRef, useState } from 'react'
import type { ProductionByGwResponse } from '../types'

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

export function ProductionStatistics({
  data,
  loading,
}: {
  data: ProductionByGwResponse | null
  loading: boolean
}) {
  const dailyChartRef = useRef<HTMLDivElement | null>(null)
  const [dailyTooltip, setDailyTooltip] = useState<{
    left: number
    top: number
    date: string
    count: number
  } | null>(null)

  const rows = data?.buckets ?? []
  const dailyRows = [...(data?.dailyLast30Years ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  const monthlyRows = [...(data?.monthlyLast12Months ?? [])].sort((a, b) => b.month.localeCompare(a.month))
  const maxCount = rows.reduce((max, item) => Math.max(max, item.count), 0)
  const dailyMax = dailyRows.reduce((max, item) => Math.max(max, item.count), 0)
  const monthlyMax = monthlyRows.reduce((max, item) => Math.max(max, item.count), 0)

  const updateDailyTooltip = (event: any, item: { date: string; count: number }) => {
    const container = dailyChartRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const barRect = event.currentTarget.getBoundingClientRect()
    const rawLeft = barRect.left - containerRect.left + barRect.width / 2
    const clampedLeft = Math.min(Math.max(rawLeft, 90), Math.max(containerRect.width - 90, 90))
    // Keep tooltip inside chart area to avoid clipping near the top edge.
    const top = Math.max(barRect.top - containerRect.top - 10, 74)
    setDailyTooltip({
      left: clampedLeft,
      top,
      date: item.date,
      count: item.count,
    })
  }

  return (
    <section className="production-page">
      <header className="production-header">
        <div className="production-title">产量统计</div>
      </header>

      {!data ? (
        <div className="production-empty">{loading ? '产量统计加载中…' : '暂无产量统计数据'}</div>
      ) : (
        <div className="production-card-grid">
          <article className="production-card">
            <div className="production-meta">
              <span>日期：{data.date}</span>
              <span>总条目：{data.totalCount}</span>
              <span>更新时间：{formatDateTime(data.generatedAt)}</span>
            </div>

            <div className="production-chart-title">当日工位产量统计</div>
            <div className="production-chart production-chart-vertical" role="img" aria-label="按gw分类的产量棒图">
              {rows.length === 0 ? (
                <div className="production-empty-inline">今日暂无符合条件的数据</div>
              ) : (
                rows.map((item) => {
                  const height = maxCount > 0 ? Math.max(8, (item.count / maxCount) * 100) : 0
                  return (
                    <div key={`gw-${item.gw}`} className="production-column">
                      <div className="production-count">{item.count}</div>
                      <div className="production-bar-track production-bar-track-vertical">
                        <div className="production-bar-fill production-bar-fill-vertical" style={{ height: `${height}%` }} />
                      </div>
                      <div className="production-gw">工位{item.gw}</div>
                    </div>
                  )
                })
              )}
            </div>
          </article>

          <article className="production-table-card">
            <div className="production-table-title">过去一月统计</div>
            <div className="production-chart-area" ref={dailyChartRef} onMouseLeave={() => setDailyTooltip(null)}>
              {dailyRows.length === 0 ? (
                <div className="production-empty-inline">暂无数据</div>
              ) : (
                <div
                  className="production-daily-bars"
                  style={{ gridTemplateColumns: `repeat(${Math.max(dailyRows.length, 1)}, minmax(0, 1fr))` }}
                  role="img"
                  aria-label="过去一月统计棒图"
                >
                  {dailyRows.map((item) => {
                    const height = dailyMax > 0 ? Math.max(4, (item.count / dailyMax) * 100) : 0
                    return (
                      <div
                        key={`d-${item.date}`}
                        className="production-daily-item"
                        onMouseEnter={(event) => updateDailyTooltip(event, item)}
                        onMouseMove={(event) => updateDailyTooltip(event, item)}
                      >
                        <div className="production-daily-value">{item.count}</div>
                        <div className="production-daily-track">
                          <div className="production-daily-fill" style={{ height: `${height}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {dailyTooltip ? (
                <div className="production-daily-tooltip" style={{ left: `${dailyTooltip.left}px`, top: `${dailyTooltip.top}px` }}>
                  <div className="production-daily-tooltip-date">{dailyTooltip.date}</div>
                  <div className="production-daily-tooltip-value">数量: {dailyTooltip.count}</div>
                </div>
              ) : null}
            </div>
          </article>

          <article className="production-table-card">
            <div className="production-table-title">过去一年统计</div>
            <div className="production-chart-area production-month-bars-horizontal production-year-chart">
              {monthlyRows.length === 0 ? (
                <div className="production-empty-inline">暂无数据</div>
              ) : (
                monthlyRows.map((item) => {
                  const width = monthlyMax > 0 ? Math.max(4, (item.count / monthlyMax) * 100) : 0
                  return (
                    <div key={`m-${item.month}`} className="production-month-row" title={`${item.month}: ${item.count}`}>
                      <div className="production-month-label-full">{item.month}</div>
                      <div className="production-month-bar-track-horizontal">
                        <div className="production-month-bar-fill-horizontal" style={{ width: `${width}%` }} />
                      </div>
                      <div className="production-month-count">{item.count}</div>
                    </div>
                  )
                })
              )}
            </div>
          </article>
        </div>
      )}
    </section>
  )
}
