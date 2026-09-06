import { Fragment, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { getGasEngineFaultReport, getGasEngineFaultTrace, getMotorFaultReport, getMotorFaultTrace, getSystemSettings } from '../api'
import type { FaultTraceResponse, FaultTrackingReportResponse } from '../types'
import { Icon } from './Icon'

const PAGE_SIZE = 100
type ReportLanguage = 'zh' | 'en'
const LANGUAGE_STORAGE_KEY = 'scada-web.native-report-language'
const columnKeys = ['sj', 'mode', 'tm', 'gw', 'model', 'ERRinformation', 'current', 'speed', 'pressure', 'flow', 'trace'] as const
const translations: Record<ReportLanguage, {
  title: string
  groups: Record<string, string>
  columns: Record<(typeof columnKeys)[number], string>
  fields: Record<string, string>
  status: Record<string, string>
  modes: { factory: string; endurance: string }
}> = {
  zh: {
    title: '电机泵故障追踪报表',
    groups: { production: '排产信息', fault: '故障信息', test: '测试数据' },
    columns: { sj: '时间', mode: '模式', tm: '条码', gw: '工位', model: '型号', ERRinformation: '故障描述', current: '电流', speed: '转速', pressure: '压力', flow: '流量', trace: '追溯' },
    fields: { language: '语言', start: '开始日期', end: '结束日期', orderNo: '订单号', barcode: '条码', station: '工位', error: '错误码', query: '查询', clear: '清空', previous: '上一页', next: '下一页', empty: '暂无数据，请设置条件后查询。', loading: '查询中...', traceLoading: '加载追溯数据...', traceEmpty: '暂无实时追溯数据', pressure: '压力', flow: '流量', traceChart: '故障实时追溯趋势' },
    status: { queryDone: '故障追踪报表查询完成', queryFailed: '故障追踪报表查询失败' },
    modes: { factory: '出厂测试', endurance: '耐久测试' },
  },
  en: {
    title: 'Motor Pump Fault Tracking Report',
    groups: { production: 'Production Info', fault: 'Fault Info', test: 'Test Data' },
    columns: { sj: 'Time', mode: 'Mode', tm: 'Barcode', gw: 'Station', model: 'Model', ERRinformation: 'Fault Description', current: 'Current', speed: 'Speed', pressure: 'Pressure', flow: 'Flow', trace: 'Trace' },
    fields: { language: 'Language', start: 'Start', end: 'End', orderNo: 'Order No.', barcode: 'Barcode', station: 'Station', error: 'Error Code', query: 'Search', clear: 'Clear', previous: 'Previous', next: 'Next', empty: 'No data. Set filters and search.', loading: 'Loading...', traceLoading: 'Loading trace...', traceEmpty: 'No real-time trace data', pressure: 'Pressure', flow: 'Flow', traceChart: 'Fault real-time trace trend' },
    status: { queryDone: 'Fault tracking report query completed', queryFailed: 'Fault tracking report query failed' },
    modes: { factory: 'Factory Test', endurance: 'Endurance Test' },
  },
}

function localDateTime(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 19)
}

function defaultFilters() {
  const to = new Date()
  to.setHours(23, 59, 59, 0)
  const from = new Date(to)
  from.setHours(0, 0, 0, 0)
  return { from: localDateTime(from), to: localDateTime(to), orderNo: '', tm: '', gw: '', err: '' }
}

function initialLanguage(): ReportLanguage {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

function formatCellValue(key: string, value: string | null, pressureUnit: string, flowUnit: string, modeLabels: { factory: string; endurance: string }) {
  if (!value) return '-'
  if (key === 'mode') return value === '0' ? modeLabels.factory : value === '1' ? modeLabels.endurance : value
  if (key === 'current') return `${value} A`
  if (key === 'speed') return `${value} RPM`
  if (key === 'pressure') return `${value} ${pressureUnit}`
  if (key === 'flow') return `${value} ${flowUnit}`
  return value
}

function traceDomain(values: number[]) {
  const finite = values.filter(Number.isFinite)
  if (finite.length === 0) return { min: 0, max: 1 }
  const minValue = Math.min(...finite)
  const maxValue = Math.max(...finite)
  if (minValue === maxValue) {
    const padding = Math.max(Math.abs(minValue) * 0.1, 0.5)
    return { min: minValue - padding, max: maxValue + padding }
  }
  return { min: minValue, max: maxValue }
}

function normalizeTraceTrend(values: number[], domain: { min: number; max: number }) {
  const range = Math.max(domain.max - domain.min, 0.000001)
  return values.map((value, index) => {
    const x = values.length <= 1 ? 50 : (index / (values.length - 1)) * 100
    const y = 38 - Math.max(0, Math.min(1, (value - domain.min) / range)) * 32
    return { x, y, value }
  })
}

function createSmoothTracePath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)]
    const current = points[index]
    const next = points[index + 1]
    const afterNext = points[Math.min(points.length - 1, index + 2)]
    path += ` C ${(current.x + (next.x - previous.x) * 0.18).toFixed(2)} ${(current.y + (next.y - previous.y) * 0.18).toFixed(2)}, ${(next.x - (afterNext.x - current.x) * 0.18).toFixed(2)} ${(next.y - (afterNext.y - current.y) * 0.18).toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`
  }
  return path
}

function TraceSparkline({ points, color, gradientId }: { points: Array<{ x: number; y: number; value: number }>; color: string; gradientId: string }) {
  const linePath = createSmoothTracePath(points)
  const firstX = points[0]?.x ?? 1
  const lastX = points[points.length - 1]?.x ?? 99
  return <>
    <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.13" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
    {linePath ? <path d={`${linePath} L ${lastX.toFixed(2)} 42 L ${firstX.toFixed(2)} 42 Z`} fill={`url(#${gradientId})`} /> : null}
    {linePath ? <path d={linePath} fill="none" stroke={color} strokeWidth="1.9" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" /> : null}
  </>
}

function formatTraceTime(value: string) {
  return value.replace('T', ' ').slice(5, 19)
}

function FaultTraceChart({ trace, pressureUnit, flowUnit, signalKey, signalUnit, labels }: { trace: FaultTraceResponse; pressureUnit: string; flowUnit: string; signalKey: 'current' | 'speed'; signalUnit: string; labels: { signal: string; pressure: string; flow: string; chartAria: string } }) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const rows = useMemo(() => trace.points.map((point) => ({
    time: point.sj,
    signal: point[signalKey] === null ? Number.NaN : Number(point[signalKey]),
    pressure: point.pressure === null ? Number.NaN : Number(point.pressure),
    flow: point.flow === null ? Number.NaN : Number(point.flow),
  })).filter((point) => Number.isFinite(point.signal) || Number.isFinite(point.pressure) || Number.isFinite(point.flow)), [signalKey, trace.points])
  const signal = rows.map((row) => Number.isFinite(row.signal) ? row.signal : 0)
  const pressure = rows.map((row) => Number.isFinite(row.pressure) ? row.pressure : 0)
  const flow = rows.map((row) => Number.isFinite(row.flow) ? row.flow : 0)
  const signalDomain = traceDomain(signal)
  const pressureDomain = traceDomain(pressure)
  const flowDomain = traceDomain(flow)
  const signalPoints = normalizeTraceTrend(signal, signalDomain)
  const pressurePoints = normalizeTraceTrend(pressure, pressureDomain)
  const flowPoints = normalizeTraceTrend(flow, flowDomain)
  const yTicks = [{ label: '100%', y: 6 }, { label: '50%', y: 22 }, { label: '0%', y: 38 }]
  const [signalGradientId] = useState(() => `fault-trace-signal-${Math.random().toString(36).slice(2, 10)}`)
  const [pressureGradientId] = useState(() => `fault-trace-pressure-${Math.random().toString(36).slice(2, 10)}`)
  const [flowGradientId] = useState(() => `fault-trace-flow-${Math.random().toString(36).slice(2, 10)}`)
  const hover = hoverIndex === null ? null : rows[hoverIndex]
  const hoverX = hoverIndex === null || rows.length <= 1 ? 50 : (hoverIndex / (rows.length - 1)) * 100
  const faultIndex = rows.findIndex((row) => row.time.replace('T', ' ').slice(0, 19) === trace.occurredAt)
  const faultX = faultIndex < 0 || rows.length <= 1 ? null : (faultIndex / (rows.length - 1)) * 100
  const xTicks = rows.length === 0 ? [] : Array.from(new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1]))
  const onMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!rows.length) return
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    setHoverIndex(Math.round(ratio * (rows.length - 1)))
  }

  return (
    <section className="native-report-chart-card motor-fault-trace-chart" aria-label={labels.chartAria}>
      <div className="native-report-chart-scroll">
        <div className="native-report-chart-stage" onMouseMove={onMouseMove} onMouseLeave={() => setHoverIndex(null)}>
          <svg className="native-report-chart dashboard-style-chart" viewBox="0 0 100 44" preserveAspectRatio="none" role="img" aria-label={labels.chartAria}>
            <line className="native-report-chart-y-axis-line" x1="0" y1="6" x2="0" y2="42" />
            {yTicks.map((tick) => <line key={tick.label} className="native-report-chart-grid-line" x1="0" y1={tick.y} x2="100" y2={tick.y} />)}
            <line className="native-report-chart-axis-line" x1="0" y1="42" x2="100" y2="42" />
            {xTicks.map((index) => <line key={index} className="native-report-chart-tick-line" x1={rows.length <= 1 ? 50 : (index / (rows.length - 1)) * 100} y1="40" x2={rows.length <= 1 ? 50 : (index / (rows.length - 1)) * 100} y2="42" />)}
            <TraceSparkline points={signalPoints} color="#1f9d69" gradientId={signalGradientId} />
            <TraceSparkline points={pressurePoints} color="#e05b61" gradientId={pressureGradientId} />
            <TraceSparkline points={flowPoints} color="#0d6efd" gradientId={flowGradientId} />
            {faultX !== null ? <g className="motor-fault-trace-marker"><line x1={faultX} y1="4" x2={faultX} y2="42" /></g> : null}
            {hover ? <g className="native-report-chart-hover"><line x1={hoverX} y1="4" x2={hoverX} y2="42" /></g> : null}
            <rect className="native-report-chart-hitarea" x="0" y="0" width="100" height="44" />
          </svg>
          <div className="native-report-chart-y-axis">{yTicks.map((tick) => <span key={tick.label} style={{ top: `${(tick.y / 44) * 100}%` }}>{tick.label}</span>)}</div>
          {hover ? <div className={`native-report-chart-tooltip${hoverX > 72 ? ' align-right' : ''}`} style={{ left: `${hoverX}%` }}>
            <div>{hover.time.replace('T', ' ').slice(0, 19)}</div>
            <div>{labels.signal}: {Number.isFinite(hover.signal) ? `${hover.signal.toFixed(2)} ${signalUnit}` : '-'}</div>
            <div>{labels.pressure}: {Number.isFinite(hover.pressure) ? `${hover.pressure.toFixed(2)} ${pressureUnit}` : '-'}</div>
            <div>{labels.flow}: {Number.isFinite(hover.flow) ? `${hover.flow.toFixed(2)} ${flowUnit}` : '-'}</div>
          </div> : null}
          <div className="motor-fault-trace-legend"><span><i className="current" />{labels.signal}</span><span><i className="pressure" />{labels.pressure}</span><span><i className="flow" />{labels.flow}</span></div>
        </div>
        <div className="native-report-chart-x-axis">{xTicks.map((index) => <span key={index} className={index === 0 ? 'align-left' : index === rows.length - 1 ? 'align-right' : ''} style={{ left: `${rows.length <= 1 ? 50 : (index / (rows.length - 1)) * 100}%` }}>{formatTraceTime(rows[index].time)}</span>)}</div>
      </div>
    </section>
  )
}

export function MotorFaultReport({ onStatus, onLanguageChange, variant = 'motor' }: { onStatus?: (message: string) => void; onLanguageChange?: (language: ReportLanguage) => void; variant?: 'motor' | 'gas' }) {
  const isGas = variant === 'gas'
  const signalKey = isGas ? 'speed' : 'current'
  const [filters, setFilters] = useState(defaultFilters)
  const [language, setLanguage] = useState<ReportLanguage>(initialLanguage)
  const [report, setReport] = useState<FaultTrackingReportResponse | null>(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [expandedTraceKey, setExpandedTraceKey] = useState<string | null>(null)
  const [traces, setTraces] = useState<Record<string, FaultTraceResponse>>({})
  const [loadingTraceKey, setLoadingTraceKey] = useState<string | null>(null)
  const [pressureUnit, setPressureUnit] = useState('MPa')
  const [flowUnit, setFlowUnit] = useState('L/M')
  const copy = translations[language]
  const columns = useMemo(() => {
    const source: Array<{ key: (typeof columnKeys)[number]; group: 'production' | 'fault' | 'test' }> = [
      { key: 'sj', group: 'production' }, { key: 'mode', group: 'production' }, { key: 'tm', group: 'production' }, { key: 'gw', group: 'production' }, { key: 'model', group: 'production' },
      { key: 'ERRinformation', group: 'fault' }, { key: signalKey, group: 'test' }, { key: 'pressure', group: 'test' }, { key: 'flow', group: 'test' }, { key: 'trace', group: 'test' },
    ]
    return source.map((column) => ({ ...column, label: copy.columns[column.key], group: copy.groups[column.group] }))
  }, [copy, signalKey])
  const totalPages = report ? Math.max(1, Math.ceil(report.rows.length / PAGE_SIZE)) : 1
  const normalizedPage = Math.min(page, totalPages)
  const rows = useMemo(() => report?.rows.slice((normalizedPage - 1) * PAGE_SIZE, normalizedPage * PAGE_SIZE) ?? [], [normalizedPage, report])
  useEffect(() => {
    let disposed = false
    getSystemSettings()
      .then((settings) => {
        if (disposed) return
        setPressureUnit(settings.pressureUnit || 'MPa')
        setFlowUnit(settings.flowUnit || 'L/M')
      })
      .catch(() => undefined)
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
    } catch {
      // Ignore unavailable browser storage.
    }
    onLanguageChange?.(language)
  }, [language, onLanguageChange])

  const query = async () => {
    try {
      setLoading(true)
      const data = isGas ? await getGasEngineFaultReport(filters) : await getMotorFaultReport(filters)
      setReport(data)
      setPage(1)
      setExpandedTraceKey(null)
      onStatus?.(`${copy.status.queryDone}: ${data.returnedCount}`)
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : copy.status.queryFailed)
    } finally {
      setLoading(false)
    }
  }

  const toggleTrace = async (row: Record<string, string | null>, rowIndex: number) => {
    const traceKey = `${row.sj ?? 'row'}-${row.gw ?? 'station'}-${rowIndex}`
    if (expandedTraceKey === traceKey) {
      setExpandedTraceKey(null)
      return
    }
    setExpandedTraceKey(traceKey)
    if (traces[traceKey] || loadingTraceKey === traceKey || !row.sj || !row.gw || !/^\d+$/.test(row.gw)) return
    try {
      setLoadingTraceKey(traceKey)
      const trace = isGas ? await getGasEngineFaultTrace(row.sj, row.gw) : await getMotorFaultTrace(row.sj, row.gw)
      setTraces((current) => ({ ...current, [traceKey]: trace }))
    } catch (error) {
      setExpandedTraceKey(null)
      onStatus?.(error instanceof Error ? error.message : copy.status.queryFailed)
    } finally {
      setLoadingTraceKey((current) => current === traceKey ? null : current)
    }
  }

  return (
    <section className="page-shell native-report-page-shell">
      <section className="native-report-toolbar">
        <div className="native-report-language-field" role="group" aria-label={copy.fields.language}><button type="button" className={language === 'zh' ? 'active' : ''} onClick={() => setLanguage('zh')}>中文</button><button type="button" className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')}>English</button></div>
        <label className="native-report-date-field"><span>{copy.fields.start}</span><input type="datetime-local" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} /></label>
        <label className="native-report-date-field"><span>{copy.fields.end}</span><input type="datetime-local" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} /></label>
        <label className="native-report-order-field"><span>{copy.fields.barcode}</span><input value={filters.tm} onChange={(event) => setFilters((current) => ({ ...current, tm: event.target.value }))} /></label>
        <label className="native-report-station-field"><span>{copy.fields.station}</span><input inputMode="numeric" value={filters.gw} onChange={(event) => setFilters((current) => ({ ...current, gw: event.target.value }))} /></label>
        <button type="button" className="primary-action native-report-icon-button" onClick={() => void query()} disabled={loading}><Icon name="search" />{copy.fields.query}</button>
        <button type="button" className="soft-action native-report-icon-button" onClick={() => { setFilters(defaultFilters()); setReport(null); setPage(1) }} disabled={loading}><Icon name="close" />{copy.fields.clear}</button>
        <div className="native-report-toolbar-pagination"><button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={!report || normalizedPage <= 1}>{copy.fields.previous}</button><strong>{report ? `${normalizedPage}/${totalPages}` : '0/0'}</strong><button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={!report || normalizedPage >= totalPages}>{copy.fields.next}</button></div>
      </section>
      <section className="native-report-body">
        <div className="native-report-export-surface">
          <header className="native-report-paper-head"><h2>{isGas ? (language === 'en' ? 'Gas Engine Fault Tracking Report' : '汽油机故障追溯报表') : copy.title}</h2></header>
          <section className="native-report-table-card"><div className="native-report-table-scroll"><table className="native-report-table motor-fault-report-table"><thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, rowIndex) => {
            const traceKey = `${row.sj ?? 'row'}-${row.gw ?? 'station'}-${rowIndex}`
            const trace = traces[traceKey]
            const isExpanded = expandedTraceKey === traceKey
            return <Fragment key={traceKey}>
              <tr>{columns.map((column) => <td key={column.key} className={`align-${column.key === 'sj' || column.key === 'trace' ? 'center' : 'left'}${column.key === 'mode' ? row.mode === '0' ? ' motor-fault-mode-factory' : row.mode === '1' ? ' motor-fault-mode-endurance' : '' : ''}`}>{column.key === 'trace' ? <button type="button" className="motor-fault-trace-button" onClick={() => void toggleTrace(row, rowIndex)} aria-label={copy.columns.trace} title={copy.columns.trace} aria-expanded={isExpanded}><Icon name="chart_data" /></button> : formatCellValue(column.key, row[column.key] ?? null, pressureUnit, flowUnit, copy.modes)}</td>)}</tr>
              {isExpanded ? <tr className="motor-fault-trace-row"><td colSpan={columns.length}>{loadingTraceKey === traceKey ? <div className="motor-fault-trace-state">{copy.fields.traceLoading}</div> : trace && trace.points.length ? <FaultTraceChart trace={trace} pressureUnit={pressureUnit} flowUnit={flowUnit} signalKey={signalKey} signalUnit={isGas ? 'RPM' : 'A'} labels={{ signal: copy.columns[signalKey], pressure: copy.columns.pressure, flow: copy.columns.flow, chartAria: copy.fields.traceChart }} /> : <div className="motor-fault-trace-state">{copy.fields.traceEmpty}</div>}</td></tr> : null}
            </Fragment>
          }) : <tr><td className="native-report-empty" colSpan={columns.length}>{loading ? copy.fields.loading : copy.fields.empty}</td></tr>}</tbody></table></div></section>
        </div>
      </section>
    </section>
  )
}
