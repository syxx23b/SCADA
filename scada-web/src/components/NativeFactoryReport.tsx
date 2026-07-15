import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import jsPDF from 'jspdf'
import { exportEnduranceTestReportExcel, exportFactoryTestReportExcel, exportGasEngineEnduranceTestReportExcel, exportGasEngineFactoryTestReportExcel, getEnduranceTestReport, getFactoryTestReport, getGasEngineEnduranceTestReport, getGasEngineFactoryTestReport, getSystemSettings } from '../api'
import type { FactoryTestReportColumn, FactoryTestReportResponse } from '../types'

type ReportLanguage = 'zh' | 'en'
type NativeReportVariant = 'factory' | 'endurance' | 'gasFactory' | 'gasEndurance'
const REPORT_LANGUAGE_STORAGE_KEY = 'scada-web.native-report-language'

const DEFAULT_REPORT_COLUMNS: FactoryTestReportColumn[] = [
  { key: 'sj', label: '时间', group: '排产信息', align: 'center' },
  { key: 'ry', label: '人员', group: '排产信息', align: 'left' },
  { key: 'tm', label: '条码', group: '排产信息', align: 'left' },
  { key: 'gw', label: '工位', group: '排产信息', align: 'right' },
  { key: 'orderNo', label: '订单号', group: '排产信息', align: 'left' },
  { key: 'model', label: '型号', group: '排产信息', align: 'left' },
  { key: 'inletPressure', label: '进水压力', group: '测试环境', align: 'right' },
  { key: 'inletTemp', label: '水温', group: '测试环境', align: 'right' },
  { key: 'lowVoltage', label: '低压启动电压', group: '电机性能', align: 'right' },
  { key: 'lowCurrent', label: '低压启动电流', group: '电机性能', align: 'right' },
  { key: 'voltage', label: '常压电压', group: '电机性能', align: 'right' },
  { key: 'frequency', label: '频率', group: '电机性能', align: 'right' },
  { key: 'current', label: '电流', group: '电机性能', align: 'right' },
  { key: 'power', label: '功率', group: '电机性能', align: 'right' },
  { key: 'powerFactor', label: '功率因数', group: '电机性能', align: 'right' },
  { key: 'pressure', label: '工作压力', group: '泵头参数', align: 'right' },
  { key: 'holdingPressure', label: '保压压力', group: '泵头参数', align: 'right' },
  { key: 'recoilPressure', label: '反冲压力', group: '泵头参数', align: 'right' },
  { key: 'siphon', label: '虹吸', group: '泵头参数', align: 'right' },
  { key: 'flow', label: '流量', group: '泵头参数', align: 'right' },
]

const GAS_FACTORY_REPORT_COLUMNS: FactoryTestReportColumn[] = [
  { key: 'sj', label: '时间', group: '排产信息', align: 'center' },
  { key: 'ry', label: '人员', group: '排产信息', align: 'left' },
  { key: 'tm', label: '条码', group: '排产信息', align: 'left' },
  { key: 'gw', label: '工位', group: '排产信息', align: 'right' },
  { key: 'orderNo', label: '订单号', group: '排产信息', align: 'left' },
  { key: 'model', label: '型号', group: '排产信息', align: 'left' },
  { key: 'inletPressure', label: '进水压力', group: '测试环境', align: 'right' },
  { key: 'inletTemp', label: '水温', group: '测试环境', align: 'right' },
  { key: 'unloadSpeed', label: '空载转速', group: '电机性能', align: 'right' },
  { key: 'loadSpeed', label: '负载转速', group: '电机性能', align: 'right' },
  { key: 'pressure', label: '工作压力', group: '泵头参数', align: 'right' },
  { key: 'holdingPressure', label: '保压压力', group: '泵头参数', align: 'right' },
  { key: 'recoilPressure', label: '反冲压力', group: '泵头参数', align: 'right' },
  { key: 'siphon', label: '虹吸', group: '泵头参数', align: 'right' },
  { key: 'flow', label: '流量', group: '泵头参数', align: 'right' },
]

const REPORT_TRANSLATIONS: Record<ReportLanguage, {
  title: string
  fields: Record<string, string>
  groups: Record<string, string>
  labels: Record<string, string>
  status: Record<string, string>
}> = {
  zh: {
    title: '清洗机测试记录报表',
    fields: {
      language: '语言',
      startDate: '开始日期',
      endDate: '结束日期',
      orderNo: '订单号',
      station: '工位',
      query: '查询',
      clear: '清空',
      exportExcel: '导出 Excel',
      exportPdf: '导出 PDF',
      previous: '上一页',
      next: '下一页',
      timestamp: '时间戳',
      pressure: '压力',
      flow: '流量',
      chartAria: '压力流量折线图',
      loading: '查询中...',
      empty: '暂无数据，请设置条件后查询。',
    },
    groups: {
      排产信息: '排产信息',
      测试环境: '测试环境',
      电机性能: '电机性能',
      泵头参数: '泵头参数',
    },
    labels: {
      sj: '时间',
      ry: '人员',
      tm: '条码',
      gw: '工位',
      orderNo: '订单号',
      model: '型号',
      inletPressure: '进水压力',
      inletTemp: '水温',
      lowVoltage: '低压启动电压',
      lowCurrent: '低压启动电流',
      unloadSpeed: '空载转速',
      loadSpeed: '负载转速',
      voltage: '常压电压',
      frequency: '频率',
      current: '电流',
      power: '功率',
      powerFactor: '功率因数',
      pressure: '工作压力',
      holdingPressure: '保压压力',
      recoilPressure: '反冲压力',
      siphon: '虹吸',
      flow: '流量',
    },
    status: {
      queryDone: '原生报表查询完成',
      queryFailed: '原生报表查询失败',
      excelDone: '原生报表 Excel 已导出',
      excelFailed: 'Excel 导出失败',
      pdfDone: '原生报表 PDF 已导出',
      pdfFailed: 'PDF 导出失败',
    },
  },
  en: {
    title: 'Pressure Washer Test Record',
    fields: {
      language: 'Language',
      startDate: 'Start',
      endDate: 'End',
      orderNo: 'Order No.',
      station: 'Station',
      query: 'Search',
      clear: 'Clear',
      exportExcel: 'Export Excel',
      exportPdf: 'Export PDF',
      previous: 'Previous',
      next: 'Next',
      timestamp: 'Timestamp',
      pressure: 'Pressure',
      flow: 'Flow',
      chartAria: 'Pressure and flow line chart',
      loading: 'Loading...',
      empty: 'No data. Set filters and search.',
    },
    groups: {
      排产信息: 'Production Info',
      测试环境: 'Test Environment',
      电机性能: 'Motor Performance',
      泵头参数: 'Pump Parameters',
    },
    labels: {
      sj: 'Time',
      ry: 'Operator',
      tm: 'Barcode',
      gw: 'Station',
      orderNo: 'Order No.',
      model: 'Model',
      inletPressure: 'Inlet Pressure',
      inletTemp: 'Water Temp.',
      lowVoltage: 'Low Start Voltage',
      lowCurrent: 'Low Start Current',
      unloadSpeed: 'Unload Speed',
      loadSpeed: 'Load Speed',
      voltage: 'Normal Voltage',
      frequency: 'Frequency',
      current: 'Current',
      power: 'Power',
      powerFactor: 'Power Factor',
      pressure: 'Work Pressure',
      holdingPressure: 'Holding Pressure',
      recoilPressure: 'Recoil Pressure',
      siphon: 'Siphon',
      flow: 'Flow',
    },
    status: {
      queryDone: 'Native report query completed',
      queryFailed: 'Native report query failed',
      excelDone: 'Native report Excel exported',
      excelFailed: 'Excel export failed',
      pdfDone: 'Native report PDF exported',
      pdfFailed: 'PDF export failed',
    },
  },
}

const REPORT_VARIANT_COPY: Record<NativeReportVariant, {
  title: Record<ReportLanguage, string>
  filePrefix: string
  includeUnits: boolean
}> = {
  factory: {
    title: {
      zh: '清洗机测试记录报表',
      en: 'Pressure Washer Test Record',
    },
    filePrefix: 'factory_test_report',
    includeUnits: true,
  },
  endurance: {
    title: {
      zh: '清洗机耐久测试记录报表',
      en: 'Pressure Washer Endurance Test Record',
    },
    filePrefix: 'endurance_test_report',
    includeUnits: true,
  },
  gasFactory: {
    title: {
      zh: '汽油机出厂测试记录报表',
      en: 'Gas Engine Factory Test Record',
    },
    filePrefix: 'gas_engine_factory_test_report',
    includeUnits: true,
  },
  gasEndurance: {
    title: {
      zh: '汽油机耐久测试记录报表',
      en: 'Gas Engine Endurance Test Record',
    },
    filePrefix: 'gas_engine_endurance_test_report',
    includeUnits: true,
  },
}
const ENDURANCE_HIDDEN_COLUMN_KEYS = new Set(['lowVoltage', 'lowCurrent'])

const PAGE_SIZE = 100
const PDF_COLUMN_WEIGHTS: Record<string, number> = {
  sj: 8.2,
  ry: 4.4,
  tm: 8.6,
  model: 6.4,
  orderNo: 7.2,
  gw: 3.2,
  inletTemp: 4.6,
  inletPressure: 5.4,
  lowVoltage: 5.2,
  lowCurrent: 5.2,
  unloadSpeed: 4.8,
  loadSpeed: 4.8,
  voltage: 4.6,
  frequency: 4.4,
  current: 4.4,
  power: 4.4,
  powerFactor: 5,
  pressure: 4.8,
  holdingPressure: 5.6,
  recoilPressure: 5.6,
  flow: 4.4,
  siphon: 4.4,
}

function toDateTimeLocal(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 19)
}

function createDefaultFilters() {
  const end = new Date()
  end.setHours(23, 59, 59, 0)
  const start = new Date(end)
  start.setDate(start.getDate() - 30)
  start.setHours(0, 0, 0, 0)
  return {
    from: toDateTimeLocal(start),
    to: toDateTimeLocal(end),
    orderNo: '',
    gw: '',
  }
}

function formatFileTimestamp() {
  return new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function formatCellValue(columnKey: string, value: string | null | undefined, pressureUnit: string, flowUnit: string, includeUnits = true) {
  if (value === null || value === undefined || value === '') return '-'
  if (!includeUnits) return value
  const numeric = Number(value)
  const formatNumber = (digits: number) => Number.isFinite(numeric) ? numeric.toFixed(digits) : value
  if (columnKey === 'inletPressure') return `${value} bar`
  if (columnKey === 'inletTemp') return `${formatNumber(1)} ℃`
  if (columnKey === 'lowVoltage' || columnKey === 'voltage') return `${formatNumber(1)} V`
  if (columnKey === 'lowCurrent' || columnKey === 'current') return `${value} A`
  if (columnKey === 'frequency') return `${formatNumber(0)} Hz`
  if (columnKey === 'power') return `${formatNumber(0)} W`
  if (columnKey === 'unloadSpeed' || columnKey === 'loadSpeed') return `${formatNumber(0)} RPM`
  if (columnKey === 'pressure' || columnKey === 'holdingPressure' || columnKey === 'recoilPressure') return `${value} ${pressureUnit}`
  if (columnKey === 'flow') return `${value} ${flowUnit}`
  if (columnKey === 'siphon') return `${formatNumber(1)} KPa`
  return value
}

function truncateCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (context.measureText(text).width <= maxWidth) return text
  let result = text
  while (result.length > 1 && context.measureText(`${result}...`).width > maxWidth) {
    result = result.slice(0, -1)
  }
  return `${result}...`
}

function drawTextCell(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  align: 'left' | 'center' | 'right',
  color = '#18243d',
) {
  const padding = 8
  context.fillStyle = color
  context.textBaseline = 'middle'
  context.textAlign = align
  const textX = align === 'left' ? x + padding : align === 'right' ? x + width - padding : x + width / 2
  context.fillText(truncateCanvasText(context, text, Math.max(12, width - padding * 2)), textX, y + height / 2)
}

function renderNativeReportPdfPage(
  columns: FactoryTestReportColumn[],
  groupedHeaders: Array<{ group: string; count: number }>,
  rows: FactoryTestReportResponse['rows'],
  pressureUnit: string,
  flowUnit: string,
  title: string,
  includeUnits = true,
) {
  const scale = 2
  const width = 2160
  const titleHeight = 54
  const groupHeaderHeight = 34
  const columnHeaderHeight = 34
  const rowHeight = 24
  const margin = 20
  const tableWidth = width - margin * 2
  const height = titleHeight + groupHeaderHeight + columnHeaderHeight + rows.length * rowHeight + margin
  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const context = canvas.getContext('2d')
  if (!context) return canvas

  context.scale(scale, scale)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.font = '700 28px "HarmonyOS Sans SC Medium", "HarmonyOS Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif'
  context.fillStyle = '#005f87'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(title, width / 2, 28)

  const totalWeight = columns.reduce((sum, column) => sum + (PDF_COLUMN_WEIGHTS[column.key] ?? 5), 0)
  const columnWidths = columns.map((column) => tableWidth * ((PDF_COLUMN_WEIGHTS[column.key] ?? 5) / totalWeight))
  const columnXs: number[] = []
  let cursorX = margin
  for (const columnWidth of columnWidths) {
    columnXs.push(cursorX)
    cursorX += columnWidth
  }

  const tableTop = titleHeight
  context.font = '700 16px "HarmonyOS Sans SC Medium", "HarmonyOS Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif'
  context.fillStyle = '#3679df'
  context.fillRect(margin, tableTop, tableWidth, groupHeaderHeight)
  context.fillStyle = '#4285f4'
  context.fillRect(margin, tableTop + groupHeaderHeight, tableWidth, columnHeaderHeight)

  let groupColumnIndex = 0
  for (const group of groupedHeaders) {
    const groupX = columnXs[groupColumnIndex]
    const groupWidth = columnWidths.slice(groupColumnIndex, groupColumnIndex + group.count).reduce((sum, value) => sum + value, 0)
    drawTextCell(context, group.group, groupX, tableTop, groupWidth, groupHeaderHeight, 'center', '#ffffff')
    groupColumnIndex += group.count
  }

  columns.forEach((column, index) => {
    const x = columnXs[index]
    const y = tableTop + groupHeaderHeight
    const cellWidth = columnWidths[index]
    drawTextCell(context, column.label, x, y, cellWidth, columnHeaderHeight, 'center', '#ffffff')
  })

  context.font = '600 14px "HarmonyOS Sans SC Medium", "HarmonyOS Sans SC", "Microsoft YaHei", "PingFang SC", sans-serif'
  rows.forEach((row, rowIndex) => {
    const y = tableTop + groupHeaderHeight + columnHeaderHeight + rowIndex * rowHeight
    context.fillStyle = rowIndex % 2 === 0 ? '#ffffff' : '#f6f9ff'
    context.fillRect(margin, y, tableWidth, rowHeight)
    columns.forEach((column, columnIndex) => {
      const x = columnXs[columnIndex]
      const cellWidth = columnWidths[columnIndex]
      drawTextCell(context, formatCellValue(column.key, row[column.key], pressureUnit, flowUnit, includeUnits), x, y, cellWidth, rowHeight, 'center')
    })
  })

  return canvas
}

function createReportTrendDomain(values: number[]) {
  const finiteValues = values.filter(Number.isFinite)
  if (finiteValues.length === 0) return { min: 0, max: 1 }
  const minValue = Math.min(...finiteValues)
  const maxValue = Math.max(...finiteValues)
  if (minValue === maxValue) {
    const padding = Math.max(Math.abs(minValue) * 0.1, 0.5)
    return { min: minValue - padding, max: maxValue + padding }
  }
  return { min: minValue, max: maxValue }
}

function normalizeReportTrend(values: number[], totalPoints = values.length, domain = createReportTrendDomain(values)) {
  if (values.length === 0) return []
  const range = Math.max(domain.max - domain.min, 1e-6)
  return values.map((value, index) => {
    const x = totalPoints <= 1 ? 50 : (index / (totalPoints - 1)) * 100
    const normalized = Math.max(0, Math.min(1, (value - domain.min) / range))
    const y = 38 - normalized * 32
    return { x, y, value }
  })
}

function createChartAxisDomain(domain: { min: number; max: number }) {
  const step = 10
  const min = Math.floor(Math.min(0, domain.min) / step) * step
  const max = Math.ceil(domain.max / step) * step
  return {
    min,
    max: Math.max(max, min + step),
  }
}

function createYAxisTicks(domain: { min: number; max: number }) {
  const step = 10
  const ticks: number[] = []
  for (let value = domain.max; value >= domain.min; value -= step) {
    ticks.push(value)
  }
  return ticks.map((value) => {
    const range = Math.max(domain.max - domain.min, 1e-6)
    const normalized = Math.max(0, Math.min(1, (value - domain.min) / range))
    return {
      value,
      y: 38 - normalized * 32,
      label: value.toFixed(0),
    }
  })
}

function createSmoothSparklinePath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  const controlScale = 0.18
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)]
    const current = points[index]
    const next = points[index + 1]
    const afterNext = points[Math.min(points.length - 1, index + 2)]
    const cp1x = current.x + (next.x - previous.x) * controlScale
    const cp1y = current.y + (next.y - previous.y) * controlScale
    const cp2x = next.x - (afterNext.x - current.x) * controlScale
    const cp2y = next.y - (afterNext.y - current.y) * controlScale
    path += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`
  }
  return path
}

function ReportSparkline({ points, color, gradientId }: { points: Array<{ x: number; y: number; value: number }>; color: string; gradientId: string }) {
  const smoothPath = createSmoothSparklinePath(points)
  const firstX = points[0]?.x ?? 1
  const lastX = points[points.length - 1]?.x ?? 99
  const areaPath = smoothPath ? `${smoothPath} L ${lastX.toFixed(2)} 42 L ${firstX.toFixed(2)} 42 Z` : ''
  return (
    <>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {areaPath ? <path d={areaPath} fill={`url(#${gradientId})`} /> : null}
      {smoothPath ? <path d={smoothPath} fill="none" stroke={color} strokeWidth="1.9" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" /> : null}
    </>
  )
}

function formatChartTime(value: string) {
  if (!value) return '-'
  const normalized = value.replace('T', ' ')
  const parts = normalized.split(' ')
  if (parts.length < 2) return normalized.slice(0, 10)
  return `${parts[0].slice(5)} ${parts[1].slice(0, 5)}`
}

function formatChartTooltipTime(value: string) {
  if (!value) return '-'
  return value.replace('T', ' ').slice(0, 19)
}

function NativeLineChart({
  points,
  pressureUnit = '',
  flowUnit = '',
  labels,
}: {
  points: FactoryTestReportResponse['chartPoints']
  pressureUnit?: string
  flowUnit?: string
  labels: { timestamp: string; pressure: string; flow: string; chartAria: string }
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const chartRows = useMemo(() => {
    return points
      .map((point) => ({
        time: point.sj ?? '',
        pressure: point.pressure === null ? null : Number(point.pressure),
        flow: point.flow === null ? null : Number(point.flow),
      }))
      .filter((row) => Number.isFinite(row.pressure) || Number.isFinite(row.flow))
      .reverse()
  }, [points])

  const [pressureGradientId] = useState(() => `report-pressure-${Math.random().toString(36).slice(2, 10)}`)
  const [flowGradientId] = useState(() => `report-flow-${Math.random().toString(36).slice(2, 10)}`)
  const pressureValues = chartRows.map((row) => Number.isFinite(row.pressure) ? row.pressure as number : 0)
  const flowValues = chartRows.map((row) => Number.isFinite(row.flow) ? row.flow as number : 0)
  const yDomain = createChartAxisDomain(createReportTrendDomain([...pressureValues, ...flowValues]))
  const yTicks = createYAxisTicks(yDomain)
  const pressurePoints = normalizeReportTrend(pressureValues, chartRows.length, yDomain)
  const flowPoints = normalizeReportTrend(flowValues, chartRows.length, yDomain)
  const hoverPoint = hoverIndex === null ? null : chartRows[hoverIndex]
  const plotLeft = 0
  const plotWidth = 100
  const hoverX = hoverIndex === null || chartRows.length <= 1 ? 50 : plotLeft + (hoverIndex / (chartRows.length - 1)) * plotWidth
  const hoverLeft = hoverX
  const xTicks = chartRows.length === 0
    ? []
    : Array.from(new Set([0, Math.floor((chartRows.length - 1) / 2), chartRows.length - 1]))
        .map((index) => ({
          index,
          x: chartRows.length <= 1 ? 50 : plotLeft + (index / (chartRows.length - 1)) * plotWidth,
          label: formatChartTime(chartRows[index]?.time ?? ''),
        }))

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (chartRows.length === 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const mouseX = ((event.clientX - rect.left) / rect.width) * 100
    const ratio = Math.max(0, Math.min(1, (mouseX - plotLeft) / plotWidth))
    setHoverIndex(Math.max(0, Math.min(chartRows.length - 1, Math.round(ratio * (chartRows.length - 1)))))
  }

  return (
    <section className="native-report-chart-card">
      <div className="native-report-chart-scroll">
        <div className="native-report-chart-stage" onMouseMove={handleMouseMove} onMouseLeave={() => setHoverIndex(null)}>
        <svg
          className="native-report-chart dashboard-style-chart"
          viewBox="0 0 100 44"
          preserveAspectRatio="none"
          role="img"
          aria-label={labels.chartAria}
        >
          <line className="native-report-chart-y-axis-line" x1="0" y1="6" x2="0" y2="42" />
          {yTicks.map((tick) => (
            <g key={tick.label}>
              <line className="native-report-chart-grid-line" x1="0" y1={tick.y} x2="100" y2={tick.y} />
            </g>
          ))}
          <line className="native-report-chart-axis-line" x1="0" y1="42" x2="100" y2="42" />
          {xTicks.map((tick) => (
            <g key={tick.index}>
              <line className="native-report-chart-tick-line" x1={tick.x} y1="40" x2={tick.x} y2="42" />
            </g>
          ))}
          <ReportSparkline points={pressurePoints} color="#e05b61" gradientId={pressureGradientId} />
          <ReportSparkline points={flowPoints} color="#0d6efd" gradientId={flowGradientId} />
          {hoverPoint ? (
            <g className="native-report-chart-hover">
              <line x1={hoverX} y1="4" x2={hoverX} y2="42" />
            </g>
          ) : null}
          <rect className="native-report-chart-hitarea" x="0" y="0" width="100" height="44" />
        </svg>
        <div className="native-report-chart-y-axis">
          {yTicks.map((tick) => (
            <span key={tick.label} style={{ top: `${(tick.y / 44) * 100}%` }}>{tick.label}</span>
          ))}
        </div>
        {hoverPoint ? (
          <div className={`native-report-chart-tooltip${hoverLeft > 72 ? ' align-right' : ''}`} style={{ left: `${hoverLeft}%` }}>
            <div>{labels.timestamp}: {formatChartTooltipTime(hoverPoint.time)}</div>
            <div>{labels.pressure}: {Number.isFinite(hoverPoint.pressure) ? `${Number(hoverPoint.pressure).toFixed(2)} ${pressureUnit}` : '-'}</div>
            <div>{labels.flow}: {Number.isFinite(hoverPoint.flow) ? `${Number(hoverPoint.flow).toFixed(2)} ${flowUnit}` : '-'}</div>
          </div>
        ) : null}
        </div>
        <div className="native-report-chart-x-axis">
          {xTicks.map((tick) => (
            <span key={tick.index} className={tick.index === 0 ? 'align-left' : tick.index === chartRows.length - 1 ? 'align-right' : ''} style={{ left: `${tick.x}%` }}>{tick.label}</span>
          ))}
        </div>
      </div>
      <div className="native-report-chart-legend">
        <span><i className="pressure" />{labels.pressure}</span>
        <span><i className="flow" />{labels.flow}</span>
      </div>
    </section>
  )
}
function readInitialReportLanguage(): ReportLanguage {
  try {
    return window.localStorage.getItem(REPORT_LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'zh'
  } catch {
    return 'zh'
  }
}

export function NativeFactoryReport({
  variant = 'factory',
  onStatus,
  onLanguageChange,
}: {
  variant?: NativeReportVariant
  onStatus?: (message: string) => void
  onLanguageChange?: (language: ReportLanguage) => void
}) {
  const [language, setLanguage] = useState<ReportLanguage>(readInitialReportLanguage)
  const [filters, setFilters] = useState(createDefaultFilters)
  const [report, setReport] = useState<FactoryTestReportResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [page, setPage] = useState(1)
  const [pressureUnit, setPressureUnit] = useState('MPa')
  const [flowUnit, setFlowUnit] = useState('L/M')
  const copy = REPORT_TRANSLATIONS[language]
  const variantCopy = REPORT_VARIANT_COPY[variant]
  const reportTitle = variantCopy.title[language]
  const includeUnits = variantCopy.includeUnits

  useEffect(() => {
    setFilters(createDefaultFilters())
    setReport(null)
    setPage(1)
  }, [variant])

  useEffect(() => {
    try {
      window.localStorage.setItem(REPORT_LANGUAGE_STORAGE_KEY, language)
    } catch {
      // ignore storage errors
    }
    onLanguageChange?.(language)
  }, [language, onLanguageChange])
  const fallbackColumns = variant === 'gasFactory' || variant === 'gasEndurance' ? GAS_FACTORY_REPORT_COLUMNS : DEFAULT_REPORT_COLUMNS
  const sourceColumns = report?.columns.length ? report.columns : fallbackColumns
  const visibleSourceColumns = variant === 'endurance'
    ? sourceColumns.filter((column) => !ENDURANCE_HIDDEN_COLUMN_KEYS.has(column.key))
    : sourceColumns
  const columns = useMemo(() => visibleSourceColumns.map((column) => ({
    ...column,
    label: copy.labels[column.key] ?? column.label,
    group: copy.groups[column.group] ?? column.group,
  })), [visibleSourceColumns, copy])
  const totalPages = report ? Math.max(1, Math.ceil(report.rows.length / PAGE_SIZE)) : 1
  const normalizedPage = Math.min(page, totalPages)
  const pageStart = (normalizedPage - 1) * PAGE_SIZE
  const pageEnd = pageStart + PAGE_SIZE
  const pagedRows = report?.rows.slice(pageStart, pageEnd) ?? []
  const pagedChartPoints = report?.chartPoints.slice(pageStart, pageEnd) ?? []
  const shouldShowChart = variant === 'endurance' || variant === 'gasEndurance'

  const queryParams = {
    from: filters.from,
    to: filters.to,
    orderNo: filters.orderNo,
    gw: filters.gw,
    lang: language,
  }

  useEffect(() => {
    let disposed = false
    getSystemSettings()
      .then((settings) => {
        if (disposed) return
        setPressureUnit(settings.pressureUnit || 'MPa')
        setFlowUnit(settings.flowUnit || 'L/M')
      })
      .catch(() => {
        if (disposed) return
        setPressureUnit('MPa')
        setFlowUnit('L/M')
      })
    return () => {
      disposed = true
    }
  }, [])

  const groupedHeaders = useMemo(() => {
    const result: Array<{ group: string; count: number }> = []
    for (const column of columns) {
      const last = result[result.length - 1]
      if (last?.group === column.group) {
        last.count += 1
      } else {
        result.push({ group: column.group, count: 1 })
      }
    }
    return result
  }, [columns])

  const queryReport = async () => {
    try {
      setLoading(true)
      setReport(null)
      setPage(1)
      const data = variant === 'gasFactory'
        ? await getGasEngineFactoryTestReport(queryParams)
        : variant === 'gasEndurance'
          ? await getGasEngineEnduranceTestReport(queryParams)
          : variant === 'endurance'
            ? await getEnduranceTestReport(queryParams)
            : await getFactoryTestReport(queryParams)
      setReport(data)
      onStatus?.(`${copy.status.queryDone}: ${data.returnedCount}`)
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : copy.status.queryFailed)
    } finally {
      setLoading(false)
    }
  }

  const clearFilters = () => {
    setFilters(createDefaultFilters())
    setReport(null)
    setPage(1)
  }

  const exportExcel = async () => {
    try {
      setExportingExcel(true)
      const blob = variant === 'gasFactory'
        ? await exportGasEngineFactoryTestReportExcel(queryParams)
        : variant === 'gasEndurance'
          ? await exportGasEngineEnduranceTestReportExcel(queryParams)
          : variant === 'endurance'
            ? await exportEnduranceTestReportExcel(queryParams)
            : await exportFactoryTestReportExcel(queryParams)
      downloadBlob(blob, `${variantCopy.filePrefix}_${formatFileTimestamp()}.xlsx`)
      onStatus?.(copy.status.excelDone)
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : copy.status.excelFailed)
    } finally {
      setExportingExcel(false)
    }
  }

  const exportPdf = async () => {
    if (!report || report.rows.length === 0) return
    try {
      setExportingPdf(true)
      const pageCount = Math.max(1, Math.ceil(report.rows.length / PAGE_SIZE))
      let pdf: jsPDF | null = null
      const pxToMm = 0.2645833333

      for (let index = 0; index < pageCount; index += 1) {
        const start = index * PAGE_SIZE
        const rows = report.rows.slice(start, start + PAGE_SIZE)
        const canvas = renderNativeReportPdfPage(columns, groupedHeaders, rows, pressureUnit, flowUnit, reportTitle, includeUnits)
        const imageData = canvas.toDataURL('image/png')
        const pageWidth = (canvas.width / 2) * pxToMm
        const pageHeight = (canvas.height / 2) * pxToMm
        if (!pdf) {
          pdf = new jsPDF({ orientation: pageWidth >= pageHeight ? 'landscape' : 'portrait', unit: 'mm', format: [pageWidth, pageHeight], compress: true })
        } else {
          pdf.addPage([pageWidth, pageHeight], pageWidth >= pageHeight ? 'landscape' : 'portrait')
        }
        pdf.addImage(imageData, 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST')
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }

      pdf?.save(`${variantCopy.filePrefix}_${formatFileTimestamp()}.pdf`)
      onStatus?.(copy.status.pdfDone)
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : copy.status.pdfFailed)
    } finally {
      setExportingPdf(false)
    }
  }

  return (
    <section className="page-shell native-report-page-shell">
      <section className="native-report-toolbar">
        <div className="native-report-language-field" role="group" aria-label={copy.fields.language}>
          <button
            type="button"
            className={language === 'zh' ? 'active' : ''}
            onClick={() => setLanguage('zh')}
          >
            中文
          </button>
          <button
            type="button"
            className={language === 'en' ? 'active' : ''}
            onClick={() => setLanguage('en')}
          >
            English
          </button>
        </div>
        <label className="native-report-date-field">
          <span>{copy.fields.startDate}</span>
          <input type="datetime-local" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} />
        </label>
        <label className="native-report-date-field">
          <span>{copy.fields.endDate}</span>
          <input
            type="datetime-local"
            value={filters.to}
            onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
          />
        </label>
        <label className="native-report-order-field">
          <span>{copy.fields.orderNo}</span>
          <input value={filters.orderNo} onChange={(event) => setFilters((current) => ({ ...current, orderNo: event.target.value }))} />
        </label>
        <label className="native-report-station-field">
          <span>{copy.fields.station}</span>
          <input value={filters.gw} inputMode="numeric" onChange={(event) => setFilters((current) => ({ ...current, gw: event.target.value }))} />
        </label>
        <button type="button" className="primary-action native-report-icon-button" onClick={() => void queryReport()} disabled={loading}>
          <span className="material-symbols-outlined" aria-hidden="true">search</span>
          {copy.fields.query}
        </button>
        <button type="button" className="soft-action native-report-icon-button" onClick={clearFilters} disabled={loading}>
          <span className="material-symbols-outlined" aria-hidden="true">close</span>
          {copy.fields.clear}
        </button>
        <button type="button" className="soft-action native-report-export-excel native-report-icon-button" onClick={() => void exportExcel()} disabled={loading || exportingExcel}>
          <span className="material-symbols-outlined" aria-hidden="true">table_view</span>
          {copy.fields.exportExcel}
        </button>
        <button type="button" className="soft-action native-report-export-pdf native-report-icon-button" onClick={() => void exportPdf()} disabled={!report || report.rows.length === 0 || exportingPdf}>
          <span className="material-symbols-outlined" aria-hidden="true">picture_as_pdf</span>
          {copy.fields.exportPdf}
        </button>
        <div className="native-report-toolbar-pagination">
          <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={!report || normalizedPage <= 1}>{copy.fields.previous}</button>
          <strong>{report ? `${normalizedPage}/${totalPages}` : '0/0'}</strong>
          <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={!report || normalizedPage >= totalPages}>{copy.fields.next}</button>
        </div>
      </section>

      <section className="native-report-body">
        <div className="native-report-export-surface">
          <header className="native-report-paper-head">
            <h2>{reportTitle}</h2>
          </header>

          {report && shouldShowChart ? (
            <NativeLineChart
              points={pagedChartPoints}
              pressureUnit={pressureUnit}
              flowUnit={flowUnit}
              labels={{ timestamp: copy.fields.timestamp, pressure: copy.fields.pressure, flow: copy.fields.flow, chartAria: copy.fields.chartAria }}
            />
          ) : null}

          <section className="native-report-table-card">
            <div className="native-report-table-scroll">
              <table className="native-report-table">
                <colgroup>
                  {columns.map((column) => (
                    <col key={column.key} className={`native-report-col-${column.key}`} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    {groupedHeaders.map((group) => (
                      <th key={group.group} colSpan={group.count} className="native-report-group-head">{group.group}</th>
                    ))}
                  </tr>
                  <tr>
                    {columns.map((column) => (
                      <th key={column.key} data-label={column.label}>{column.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row, rowIndex) => (
                    <tr key={`${row.sj ?? rowIndex}-${row.tm ?? ''}-${pageStart + rowIndex}`}>
                      {columns.map((column) => (
                        <td key={column.key} className={`align-${column.align}`}>{formatCellValue(column.key, row[column.key], pressureUnit, flowUnit, includeUnits)}</td>
                      ))}
                    </tr>
                  ))}
                  {!report || report.rows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length} className="native-report-empty">{loading ? copy.fields.loading : copy.fields.empty}</td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </section>
  )
}


