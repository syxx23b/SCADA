import { useRef } from 'react'
import html2canvas from 'html2canvas'
import jsPDF from 'jspdf'
import type { FaultByGwResponse } from '../types'

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

export function FaultAnalysis({
  data,
  loading,
}: {
  data: FaultByGwResponse | null
  loading: boolean
}) {
  const quarterExportRef = useRef<HTMLDivElement | null>(null)

  const faultBuckets = data?.faultBuckets ?? []
  const qualifiedBuckets = data?.qualifiedBuckets ?? []
  const quarterErrorDefinitions = data?.quarterErrorDefinitions ?? []
  const quarterErrorDetails = data?.quarterErrorDetails ?? []
  const quarterQualifiedDetails = data?.quarterQualifiedDetails ?? []
  const quarterErrCodes = quarterErrorDefinitions.length > 0
    ? quarterErrorDefinitions.map((item) => item.err)
    : Array.from(new Set(quarterErrorDetails.map((item) => item.err))).sort((a, b) => a - b)
  const quarterErrorLabelMap = new Map<number, string>(
    quarterErrorDefinitions.map((item) => [item.err, item.information]),
  )
  const quarterDates = Array.from(new Set([
    ...quarterErrorDetails.map((item) => item.date),
    ...quarterQualifiedDetails.map((item) => item.date),
  ])).sort((a, b) => b.localeCompare(a))
  const quarterMatrix = new Map<string, number>()
  quarterErrorDetails.forEach((item) => {
    quarterMatrix.set(`${item.date}|${item.err}`, item.count)
  })
  const quarterQualifiedMap = new Map<string, number>()
  quarterQualifiedDetails.forEach((item) => {
    quarterQualifiedMap.set(item.date, item.count)
  })
  const gwSet = new Set<number>()
  faultBuckets.forEach((item) => gwSet.add(item.gw))
  qualifiedBuckets.forEach((item) => gwSet.add(item.gw))
  const rows = Array.from(gwSet)
    .sort((a, b) => a - b)
    .map((gw) => {
      const fault = faultBuckets.find((item) => item.gw === gw)?.count ?? 0
      const qualified = qualifiedBuckets.find((item) => item.gw === gw)?.count ?? 0
      return { gw, fault, qualified, total: fault + qualified }
    })
  const maxTotal = rows.reduce((max, item) => Math.max(max, item.total), 0)

  const quarterRows = quarterDates.map((date) => {
    const errCounts = quarterErrCodes.map((err) => quarterMatrix.get(`${date}|${err}`) ?? 0)
    const faultTotal = errCounts.reduce((sum, count) => sum + count, 0)
    const qualifiedTotal = quarterQualifiedMap.get(date) ?? 0
    const total = faultTotal + qualifiedTotal
    const passRateValue = total > 0 ? (qualifiedTotal / total) * 100 : null
    const passRate = passRateValue !== null ? `${passRateValue.toFixed(1)}%` : '-'
    const maxErrCount = errCounts.reduce((max, count) => Math.max(max, count), 0)
    const passRateClass =
      passRateValue === null
        ? ''
        : passRateValue > 95
          ? 'fault-pass-rate-high'
          : passRateValue >= 85
            ? 'fault-pass-rate-mid'
            : 'fault-pass-rate-low'

    return {
      date,
      errCounts,
      faultTotal,
      qualifiedTotal,
      passRate,
      maxErrCount,
      passRateClass,
    }
  })

  const exportQuarterAsPdf = async () => {
    if (quarterRows.length === 0) return
    const exportNode = quarterExportRef.current
    if (!exportNode) return

    const canvas = await html2canvas(exportNode, {
      backgroundColor: '#ffffff',
      scale: 2,
      useCORS: true,
      logging: false,
    })
    const imageData = canvas.toDataURL('image/png')
    const pdf = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a3',
      compress: true,
    })

    const pageWidth = pdf.internal.pageSize.getWidth()
    const pageHeight = pdf.internal.pageSize.getHeight()
    const margin = 6
    const renderWidth = pageWidth - margin * 2
    const renderHeight = (canvas.height * renderWidth) / canvas.width
    const pageRenderHeight = pageHeight - margin * 2
    let heightLeft = renderHeight
    let offsetY = margin

    pdf.addImage(imageData, 'PNG', margin, offsetY, renderWidth, renderHeight, undefined, 'FAST')
    heightLeft -= pageRenderHeight

    while (heightLeft > 0) {
      pdf.addPage()
      offsetY = margin - (renderHeight - heightLeft)
      pdf.addImage(imageData, 'PNG', margin, offsetY, renderWidth, renderHeight, undefined, 'FAST')
      heightLeft -= pageRenderHeight
    }

    pdf.save(`过去1个季度故障统计_${new Date().toISOString().slice(0, 10)}.pdf`)
  }

  return (
    <section className="production-page fault-page">
      <header className="production-header">
        <div className="production-title">故障分析</div>
      </header>

      {!data ? (
        <div className="production-empty">{loading ? '故障分析加载中…' : '暂无故障分析数据'}</div>
      ) : (
        <div className="production-card-grid">
          <article className="production-card">
            <div className="production-meta">
              <span>日期：{data.date}</span>
              <span>故障条目：{data.totalFaultCount}</span>
              <span>合格条目：{data.totalQualifiedCount}</span>
              <span>更新时间：{formatDateTime(data.generatedAt)}</span>
            </div>

            <div className="production-chart-title">当日工位故障统计</div>
            <div className="fault-legend">
              <span className="fault-legend-item"><i className="fault-legend-dot fault-legend-dot-qualified" />合格</span>
              <span className="fault-legend-item"><i className="fault-legend-dot fault-legend-dot-fault" />故障</span>
            </div>
            <div className="production-chart production-chart-vertical" role="img" aria-label="按工位分组的故障数量柱状图">
              {rows.length === 0 ? (
            <div className="production-empty-inline">今日暂无符合条件的数据</div>
              ) : (
                rows.map((item) => {
                  const qualifiedHeight = maxTotal > 0 ? Math.max(item.qualified > 0 ? 8 : 0, (item.qualified / maxTotal) * 100) : 0
                  const faultHeight = maxTotal > 0 ? Math.max(item.fault > 0 ? 8 : 0, (item.fault / maxTotal) * 100) : 0
                  const passRate = item.total > 0 ? ((item.qualified / item.total) * 100).toFixed(1) : '-'
                  return (
                    <div
                      key={`fault-gw-${item.gw}`}
                      className="production-column"
                      title={`工位${item.gw}\n合格: ${item.qualified}\n故障: ${item.fault}\n合格率: ${passRate === '-' ? '-' : `${passRate}%`}`}
                    >
                      <div className="production-count">{item.total}</div>
                      <div className="production-bar-track production-bar-track-vertical">
                        <div className="production-bar-fill production-bar-fill-vertical fault-bar-fill-vertical" style={{ height: `${qualifiedHeight + faultHeight}%` }}>
                          <div className="fault-bar-fault" style={{ height: `${faultHeight}%` }} />
                          <div className="fault-bar-qualified" style={{ height: `${qualifiedHeight}%` }} />
                        </div>
                      </div>
                      <div className="production-gw">工位{item.gw}</div>
                    </div>
                  )
                })
              )}
            </div>
          </article>

          <article className="production-table-card">
            <div className="production-table-head">
              <div className="production-table-actions">
                <div className="production-table-heading">
                  <div className="production-table-title">过去1个季度故障统计</div>
                </div>
                <button
                  type="button"
                  className="production-export-btn"
                  onClick={() => void exportQuarterAsPdf()}
                  disabled={quarterRows.length === 0}
                  title="导出PDF"
                  aria-label="导出PDF"
                >
                  PDF
                </button>
              </div>
              <div className="production-table-subtitle">
                故障统计仅供参考，数值为测试过程中采集到的报警数量，不等于故障产品数量。
              </div>
            </div>
            <div className="production-table-wrap" ref={quarterExportRef}>
              {quarterDates.length === 0 ? (
                <div className="production-empty-inline">暂无过去1个季度故障数据</div>
              ) : (
                <table className="production-table" role="table" aria-label="过去1个季度故障明细表">
                  <thead>
                    <tr>
                      <th>日期</th>
                      {quarterErrCodes.map((err) => (
                        <th key={`err-h-${err}`} title={`ERR${err} ${quarterErrorLabelMap.get(err) ?? `ERR${err}`}`}>
                          {quarterErrorLabelMap.get(err) ?? `ERR${err}`}
                        </th>
                      ))}
                      <th>故障总数</th>
                      <th>合格总数</th>
                      <th>合格率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quarterRows.map((row) => (
                      <tr key={`err-row-${row.date}`}>
                        <td>{row.date}</td>
                        {quarterErrCodes.map((err, index) => (
                          <td
                            key={`err-cell-${row.date}-${err}`}
                            className={row.errCounts[index] === row.maxErrCount && row.maxErrCount > 0 ? 'fault-err-peak' : ''}
                          >
                            {row.errCounts[index] === 0 ? '' : row.errCounts[index]}
                          </td>
                        ))}
                        <td>{row.faultTotal === 0 ? '' : row.faultTotal}</td>
                        <td>{row.qualifiedTotal === 0 ? '' : row.qualifiedTotal}</td>
                        <td className={row.passRateClass}>{row.passRate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </article>
        </div>
      )}
    </section>
  )
}
