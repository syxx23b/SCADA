import { useMemo, useState } from 'react'
import type { RepairRecordDailyResponse, RepairRecordListResponse } from '../types'

function formatDateInput(value: Date) {
  const y = value.getFullYear()
  const m = String(value.getMonth() + 1).padStart(2, '0')
  const d = String(value.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const TODAY = new Date()
const DEFAULT_TO = formatDateInput(TODAY)
const DEFAULT_FROM = formatDateInput(new Date(TODAY.getTime() - 30 * 24 * 3600 * 1000))

export function ReworkRecords({
  onSearch,
  onLoadDaily,
}: {
  onSearch: (from: string, to: string) => Promise<RepairRecordListResponse>
  onLoadDaily: (months?: number) => Promise<RepairRecordDailyResponse>
}) {
  const [from, setFrom] = useState(DEFAULT_FROM)
  const [to, setTo] = useState(DEFAULT_TO)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RepairRecordListResponse | null>(null)
  const [daily, setDaily] = useState<RepairRecordDailyResponse | null>(null)

  const bars = useMemo(() => {
    const points = daily?.daily ?? []
    const byMonth = new Map<string, number>()
    for (const item of points) {
      const monthKey = item.date.slice(0, 7)
      byMonth.set(monthKey, (byMonth.get(monthKey) ?? 0) + item.count)
    }
    const rows = Array.from(byMonth.entries())
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month))
    const max = Math.max(...rows.map((item) => item.count), 1)
    return rows.map((item) => ({
      month: item.month,
      count: item.count,
      width: Math.max(12, Math.round((item.count / max) * 100)),
    }))
  }, [daily])

  const loadAll = async () => {
    try {
      setLoading(true)
      setError(null)
      const [records, dailyStats] = await Promise.all([onSearch(from, to), onLoadDaily(12)])
      setResult(records)
      setDaily(dailyStats)
    } catch (err) {
      setError(err instanceof Error ? err.message : '查询失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="production-page rework-page">
      <header className="production-header">
        <div className="production-title">返修记录</div>
        <div className="production-subtitle">按时间查询返修确认记录，并统计过去12个月每日数量</div>
      </header>

      <article className="production-table-card rework-result-card">
        <div className="production-table-title">返修记录列表</div>
        <div className="rework-record-filter-row" style={{ marginBottom: 12 }}>
          <label>开始日期 <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>结束日期 <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button type="button" className="primary-action" onClick={() => void loadAll()} disabled={loading}>
            {loading ? '查询中...' : '查询'}
          </button>
        </div>
        {error ? <div className="rework-query-error">{error}</div> : null}
        {!result ? (
          <div className="production-empty-inline">请先查询</div>
        ) : result.items.length === 0 ? (
          <div className="production-empty-inline">当前时间范围无返修记录</div>
        ) : (
          <div className="table-shell">
            <div className="table-scroll">
              <table className="runtime-table">
                <thead>
                  <tr>
                    <th>确认时间</th>
                    <th>条码</th>
                    <th>维修措施</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <tr key={item.id}>
                      <td>{item.confirmedAt}</td>
                      <td>{item.tm}</td>
                      <td>{item.repairMeasure}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </article>

      <article className="production-table-card rework-result-card">
        <div className="production-table-title">过去12个月每月返修数量</div>
        {!daily ? (
          <div className="production-empty-inline">请先查询</div>
        ) : bars.length === 0 ? (
          <div className="production-empty-inline">暂无统计数据</div>
        ) : (
          <div className="rework-bar-chart-horizontal">
            {bars.map((bar) => (
              <div className="rework-bar-row" key={bar.month} title={`${bar.month}: ${bar.count}`}>
                <div className="rework-bar-date">{bar.month}</div>
                <div className="rework-bar-track">
                  <div className="rework-bar-fill" style={{ width: `${bar.width}%` }} />
                </div>
                <div className="rework-bar-count">{bar.count}</div>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  )
}
