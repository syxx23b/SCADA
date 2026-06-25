import * as echarts from 'echarts'
import { useEffect, useRef, useState } from 'react'
import type { ProductionByGwResponse } from '../types'

function createSmoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length < 2) return ''
  if (points.length === 2) return `M${points[0].x},${points[0].y} L${points[1].x},${points[1].y}`
  let d = `M${points[0].x},${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const cp1x = p1.x + (p2.x - p0.x) / 6
    const cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    const cp2y = p2.y - (p3.y - p1.y) / 6
    d += ` C${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`
  }
  return d
}

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

function getVirtualData(year: string, dailyRows: Array<{ date: string; count: number }>) {
  const date = +echarts.time.parse(year + '-01-01')
  const end = +echarts.time.parse(+year + 1 + '-01-01')
  const dayTime = 3600 * 24 * 1000
  const rowMap = new Map(dailyRows.map((item) => [item.date, item.count]))
  const data: [string, number][] = []
  for (let time = date; time < end; time += dayTime) {
    const key = echarts.time.format(time, '{yyyy}-{MM}-{dd}', false)
    data.push([key, rowMap.get(key) ?? 0])
  }
  return data
}

export function ProductionStatistics({
  data,
  loading,
}: {
  data: ProductionByGwResponse | null
  loading: boolean
}) {
  const dailyChartRef = useRef<HTMLDivElement | null>(null)
  const dailyBarsRef = useRef<HTMLDivElement | null>(null)
  const annualCalendarRef = useRef<HTMLDivElement | null>(null)
  const [barCenters, setBarCenters] = useState<number[]>([])
  const [chartWidth, setChartWidth] = useState(0)
  const [lineTooltip, setLineTooltip] = useState<{
    left: number
    top: number
    date: string
    count: number
  } | null>(null)

  const annualYear = String(new Date().getFullYear())

  const rows = data?.buckets ?? []
  const dailyRows = [...(data?.dailyLast30Years ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  const monthlyRows = [...(data?.monthlyLast12Months ?? [])].sort((a, b) => b.month.localeCompare(a.month))
  const annualDailyRows = [...(data?.annualCurrentYearDaily ?? [])].sort((a, b) => a.date.localeCompare(b.date))
  const maxCount = rows.reduce((max, item) => Math.max(max, item.count), 0)
  const dailyMax = dailyRows.reduce((max, item) => Math.max(max, item.count), 0)
  const monthlyMax = monthlyRows.reduce((max, item) => Math.max(max, item.count), 0)
  const annualMax = Math.max(1000, annualDailyRows.reduce((max, item) => Math.max(max, item.count), 0))
  const lineWidth = chartWidth > 0 ? chartWidth : Math.max(680, dailyRows.length * 26)
  const lineHeight = 220
  const linePaddingLeft = 0
  const linePaddingRight = 0
  const linePaddingTop = 16
  const linePaddingBottom = 26
  const plotWidth = lineWidth - linePaddingLeft - linePaddingRight
  const plotHeight = lineHeight - linePaddingTop - linePaddingBottom
  const stepX = dailyRows.length > 1 ? plotWidth / (dailyRows.length - 1) : 0
  const linePoints = dailyRows.map((item, index) => {
    const fallbackX = dailyRows.length > 0 ? ((index + 0.5) / dailyRows.length) * lineWidth : linePaddingLeft + index * stepX
    const x = barCenters[index] ?? fallbackX
    const ratio = dailyMax > 0 ? item.count / dailyMax : 0
    const y = linePaddingTop + (1 - ratio) * plotHeight
    return { x, y, value: item.count, date: item.date }
  })
  const linePath = createSmoothPath(linePoints)
  const lineAreaPath = linePoints.length
    ? `${linePath} L${linePaddingLeft + plotWidth},${linePaddingTop + plotHeight} L${linePaddingLeft},${linePaddingTop + plotHeight} Z`
    : ''

  useEffect(() => {
    const recalc = () => {
      const bars = dailyBarsRef.current
      if (!bars) return
      const width = bars.clientWidth
      const items = Array.from(bars.querySelectorAll('.production-daily-item')) as HTMLElement[]
      const centers = items.map((el) => el.offsetLeft + el.offsetWidth / 2)
      setChartWidth(width)
      setBarCenters(centers)
    }

    recalc()
    window.addEventListener('resize', recalc)
    return () => window.removeEventListener('resize', recalc)
  }, [dailyRows.length])

  useEffect(() => {
    const chartElement = annualCalendarRef.current
    if (!chartElement) return

    const chart = echarts.init(chartElement)
    chart.setOption({
      tooltip: {
        trigger: 'item',
        confine: true,
        enterable: false,
        position: 'top',
        formatter: (p: { data?: [string, number] }) => {
          if (!p.data) return ''
          const format = echarts.time.format(p.data[0], '{yyyy}-{MM}-{dd}', false)
          return [
            '<div class="production-calendar-tooltip">',
            `<div class="production-calendar-tooltip-date">${format}</div>`,
            '<div class="production-calendar-tooltip-value">',
            '<span class="production-calendar-tooltip-marker"></span>',
            `数量: ${p.data[1]}`,
            '</div>',
            '</div>',
          ].join('')
        },
        backgroundColor: '#0f172a',
        borderColor: '#0f172a',
        borderWidth: 0,
        padding: 0,
        showDelay: 0,
        hideDelay: 120,
        transitionDuration: 0,
        extraCssText: 'box-shadow: 0 12px 28px rgba(15, 23, 42, 0.28); border-radius: 0; pointer-events: none;',
      },
      visualMap: {
        show: false,
        min: 0,
        max: annualMax,
        calculable: true,
        inRange: {
          color: ['#d1d5db', '#dbeafe', '#93c5fd', '#38bdf8', '#22c55e', '#f59e0b', '#dc2626'],
        },
      },
      calendar: {
        orient: 'vertical',
        top: 16,
        left: 'center',
        bottom: 16,
        range: annualYear,
        cellSize: [18, 18],
        splitLine: {
          show: true,
          lineStyle: {
            color: '#94a3b8',
            width: 0.5,
          },
        },
        itemStyle: {
          borderWidth: 0.5,
          borderColor: '#d7e2f5',
        },
        yearLabel: {
          show: false,
        },
        monthLabel: {
          nameMap: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
          color: '#475569',
          fontSize: 13,
        },
        dayLabel: {
          show: false,
        },
      },
      series: {
        type: 'heatmap',
        coordinateSystem: 'calendar',
        data: getVirtualData(annualYear, annualDailyRows),
      },
    })

    const resize = () => chart.resize()
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(chartElement)
    window.addEventListener('resize', resize)

    return () => {
      window.removeEventListener('resize', resize)
      resizeObserver.disconnect()
      chart.dispose()
    }
  }, [annualDailyRows, annualYear])

  const updateLineTooltip = (
    event: React.MouseEvent<SVGElement, MouseEvent>,
    point: { x: number; y: number; value: number; date: string },
  ) => {
    const container = dailyChartRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    const rawLeft = event.clientX - containerRect.left
    const rawTop = event.clientY - containerRect.top
    const left = Math.min(Math.max(rawLeft, 84), Math.max(containerRect.width - 84, 84))
    const top = Math.max(rawTop + 18, 220)
    setLineTooltip({
      left,
      top,
      date: point.date,
      count: point.value,
    })
  }

  const updateLineTooltipBySvgMouse = (event: React.MouseEvent<SVGSVGElement, MouseEvent>) => {
    if (linePoints.length === 0) return
    const svgRect = event.currentTarget.getBoundingClientRect()
    const relativeX = event.clientX - svgRect.left
    const normalizedX = svgRect.width > 0 ? (relativeX / svgRect.width) * lineWidth : 0

    let nearestPoint = linePoints[0]
    let nearestDistance = Math.abs(nearestPoint.x - normalizedX)
    for (let i = 1; i < linePoints.length; i += 1) {
      const distance = Math.abs(linePoints[i].x - normalizedX)
      if (distance < nearestDistance) {
        nearestDistance = distance
        nearestPoint = linePoints[i]
      }
    }

    updateLineTooltip(event, nearestPoint)
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
          <div className="production-lower-grid">
            <article className="production-table-card production-calendar-card">
              <div className="production-calendar-head">
                <div className="production-table-title">产量热力图</div>
                <div className="production-calendar-legend-row">
                  <div className="production-calendar-legend" aria-label="产量颜色图例">
                    <span>0</span>
                    <div className="production-calendar-legend-bar" />
                    <span>{annualMax}</span>
                  </div>
                </div>
              </div>
              <div className="production-calendar-echart" ref={annualCalendarRef} />
            </article>

            <div className="production-lower-stack">
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
                <div
                  className="production-chart-area production-chart-area-monthly"
                  ref={dailyChartRef}
                  onMouseLeave={() => {
                    setLineTooltip(null)
                  }}
                >
                  {dailyRows.length === 0 ? (
                    <div className="production-empty-inline">暂无数据</div>
                  ) : (
                    <>
                      <div style={{ position: 'relative' }}>
                        <div
                          className="production-daily-bars"
                          ref={dailyBarsRef}
                          style={{ gridTemplateColumns: `repeat(${Math.max(dailyRows.length, 1)}, minmax(0, 1fr))` }}
                          role="img"
                          aria-label="过去一月统计棒图"
                        >
                          {dailyRows.map((item) => {
                            const height = dailyMax > 0 ? Math.max(4, (item.count / dailyMax) * 100) : 0
                            return (
                              <div key={`d-${item.date}`} className="production-daily-item">
                                <div className="production-daily-value">{item.count}</div>
                                <div className="production-daily-track">
                                  <div className="production-daily-fill" style={{ height: `${height}%` }} />
                                </div>
                              </div>
                            )
                          })}
                        </div>

                        <div className="production-line-scroll" role="img" aria-label="过去一月统计折线图" style={{ position: 'absolute', inset: 0 }}>
                          <svg
                            className="production-line-chart"
                            viewBox={`0 0 ${lineWidth} ${lineHeight}`}
                            preserveAspectRatio="none"
                            onMouseMove={updateLineTooltipBySvgMouse}
                            onMouseEnter={updateLineTooltipBySvgMouse}
                          >
                            <defs>
                              <linearGradient id="productionLineAreaBlue" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.45" />
                                <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.06" />
                              </linearGradient>
                            </defs>
                            <line
                              className="production-axis-line"
                              x1={linePaddingLeft}
                              y1={linePaddingTop + plotHeight}
                              x2={linePaddingLeft + plotWidth}
                              y2={linePaddingTop + plotHeight}
                            />
                            {lineAreaPath ? <path className="production-line-area production-line-area-blue" d={lineAreaPath} /> : null}
                            {linePath ? <path className="production-line-path production-line-path-blue" d={linePath} /> : null}
                          </svg>
                        </div>

                        {lineTooltip ? (
                          <>
                            <div className="production-line-hover-dot-fixed" style={{ left: `${lineTooltip.left}px`, top: `${lineTooltip.top - 48}px` }} />
                            <div className="production-line-tooltip" style={{ left: `${lineTooltip.left}px`, top: `${lineTooltip.top}px` }}>
                              <div className="production-line-tooltip-date">{lineTooltip.date}</div>
                              <div className="production-line-tooltip-value">
                                <span className="production-line-tooltip-bullet" />
                                数量: {lineTooltip.count}
                              </div>
                            </div>
                          </>
                        ) : null}
                      </div>
                    </>
                  )}
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
          </div>
        </div>
      )}
    </section>
  )
}


