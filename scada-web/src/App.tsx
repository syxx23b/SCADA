import { useEffect, useMemo, useState } from 'react'
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr'
import type { ReactNode } from 'react'
import './App.css'
import { browseDevice, connectDevice, createDevice, createTag, deleteTag, disconnectDevice, getDevices, getRuntimeOverview, getTags, openVncTool, updateDevice, updateTag, writeTag } from './api'
import type { BrowseNode, DeviceConnection, DeviceFormState, RuntimeOverview, TagDefinition, TagFormState, TagSnapshot } from './types'

type ViewKey = 'dashboard' | 'runtime' | 'tags' | 'batch' | 'devices'
type RuntimeStatus = { label: '正常' | '异常'; className: 'normal' | 'fault' }
type HistoryPoint = { ts: number; value: number }
type DashboardField = { tag?: TagDefinition; snapshot?: TagSnapshot; numeric: number | null; text: string }
type FaceplateTrend = { pressure: HistoryPoint[]; flow: HistoryPoint[] }

const sidebarItems: Array<{ key: ViewKey; label: string; icon: string }> = [
  { key: 'dashboard', label: 'Dashboard', icon: '◉' },
  { key: 'runtime', label: '监控', icon: '▲' },
  { key: 'tags', label: '订阅', icon: '▣' },
  { key: 'batch', label: '批量', icon: '⌘' },
  { key: 'devices', label: '设备', icon: '◫' },
]
const dashboardFaceplateIndexes = [1, 2] as const

function getInitialView(): ViewKey {
  const value = new URLSearchParams(window.location.search).get('view')
  return value === 'dashboard' || value === 'runtime' || value === 'tags' || value === 'batch' || value === 'devices' ? value : 'dashboard'
}

function blankDeviceForm(): DeviceFormState {
  return { name: '', endpointUrl: '', securityMode: 'None', securityPolicy: 'None', authMode: 'Anonymous', username: '', password: '', autoConnect: true }
}

function getDisplayName(nodeId: string) {
  let value = nodeId
  const index = value.indexOf(';s=')
  if (index >= 0) value = value.slice(index + 3)
  if (value.startsWith('|var|')) value = value.slice(5)
  const appIndex = value.indexOf('.Application.')
  if (appIndex >= 0) value = value.slice(appIndex + '.Application.'.length)
  return value || nodeId
}

function getResolvedGroup(deviceName: string, tag: TagDefinition) {
  const explicit = tag.groupKey?.trim()
  if (explicit) return explicit
  const match = getDisplayName(tag.nodeId).match(/HMI_DB\.(?:HMI_Faceplates|Faceplates)\[(\d+)\]/i)
  return match ? `${deviceName}_HMI${match[1]}` : '未分组'
}

function statusOf(snapshot: TagSnapshot | undefined, deviceStatus: string | undefined): RuntimeStatus {
  const device = (deviceStatus ?? '').toLowerCase()
  if (device !== '' && device !== 'connected') return { label: '异常', className: 'fault' }
  if (!snapshot) return { label: '异常', className: 'fault' }
  const q = (snapshot.quality ?? '').toLowerCase()
  const s = (snapshot.connectionState ?? '').toLowerCase()
  const ok = (s === '' || s === 'connected') && (q === '' || q === 'good' || q === '0' || q === '00000000' || q === '0000000')
  return ok ? { label: '正常', className: 'normal' } : { label: '异常', className: 'fault' }
}

function formatValue(tag: TagDefinition, snapshot: TagSnapshot | undefined) {
  if (snapshot?.value === null || snapshot?.value === undefined || snapshot?.value === '') return '暂无数据'
  if (typeof snapshot.value === 'number' && /float|single|double/i.test(tag.dataType)) return snapshot.value.toFixed(2)
  if (typeof snapshot.value === 'boolean') return snapshot.value ? 'True' : 'False'
  return String(snapshot.value)
}

function compactTimeText(snapshot: TagSnapshot | undefined) {
  if (!snapshot?.sourceTimestamp) return '-'
  const date = new Date(snapshot.sourceTimestamp)
  if (Number.isNaN(date.getTime())) return '-'
  const yyyy = date.getFullYear()
  const mm = date.getMonth() + 1
  const dd = date.getDate()
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss}`
}

function inferUnit(label: string) {
  const value = label.toLowerCase()
  if (/inletpressure/.test(value)) return 'bar'
  if (/pressure|press/.test(value)) return 'MPa'
  if (/flow/.test(value)) return 'L/M'
  if (/power/.test(value)) return 'W'
  if (/temp|temperature/.test(value)) return '°C'
  if (/frequency|freq/.test(value)) return 'Hz'
  if (/current/.test(value)) return 'A'
  if (/voltage/.test(value)) return 'V'
  if (/speed|rpm/.test(value)) return 'rpm'
  if (/percent|ratio|rate/.test(value)) return '%'
  if (/time|hour/.test(value)) return 'h'
  if (/count|number|num/.test(value)) return 'pcs'
  return ''
}

function toNumericValue(value: TagSnapshot['value']) {
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const cleaned = value.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
    const parsed = cleaned ? Number(cleaned[0]) : Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function formatNumberWithUnit(value: number | null, unit: string, digits?: number) {
  if (value === null) return `- ${unit}`.trim()
  const rounded =
    typeof digits === 'number'
      ? value.toFixed(digits)
      : Number.isInteger(value)
        ? value.toString()
        : value.toFixed(2)
  return unit ? `${rounded} ${unit}` : rounded
}

function normalizeTrend(points: HistoryPoint[]) {
  if (points.length === 0) return []
  const usePoints = points.length === 1 ? [{ ts: points[0].ts - 60_000, value: points[0].value }, points[0]] : points
  const values = usePoints.map((point) => point.value)
  const sorted = [...values].sort((left, right) => left - right)
  const pick = (ratio: number) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)))]
  const q10 = pick(0.1)
  const q90 = pick(0.9)
  const center = (q10 + q90) / 2
  const halfRange = Math.max((q90 - q10) / 2, Math.max(...values.map((value) => Math.abs(value - center))) * 0.6, 0.5)
  const min = center - halfRange
  const max = center + halfRange
  const range = Math.max(max - min, 1e-6)
  return usePoints.map((point, index) => {
    const x = usePoints.length === 1 ? 100 : (index / (usePoints.length - 1)) * 100
    const normalized = Math.max(0, Math.min(1, (point.value - min) / range))
    const y = 40 - normalized * 34
    return { x, y, value: point.value }
  })
}

function errCodeToStatus(errCode: number) {
  const dictionary: Record<number, { text: string; className: 'normal' | 'fault' }> = {
    0: { text: '正常', className: 'normal' },
    1: { text: '不通电', className: 'fault' },
    2: { text: '低压启动失败', className: 'fault' },
    3: { text: '工作电流低', className: 'fault' },
    4: { text: '工作电流高', className: 'fault' },
    5: { text: '工作压力低', className: 'fault' },
    6: { text: '工作压力高', className: 'fault' },
    7: { text: '工作流量低', className: 'fault' },
    8: { text: '工作流量高', className: 'fault' },
    9: { text: '保压压力低', className: 'fault' },
    10: { text: '保压压力高', className: 'fault' },
    11: { text: '反冲压力低', className: 'fault' },
    12: { text: '反冲压力高', className: 'fault' },
    13: { text: '保压电流低', className: 'fault' },
    14: { text: '保压电流高', className: 'fault' },
    15: { text: '关枪不停机', className: 'fault' },
    16: { text: '吸液不合格', className: 'fault' },
    17: { text: '不保压', className: 'fault' },
    18: { text: '进水压力低', className: 'fault' },
    19: { text: '工压不稳', className: 'fault' },
    21: { text: '泵盖渗漏', className: 'fault' },
    22: { text: '泵体渗漏', className: 'fault' },
    23: { text: '油缸渗漏', className: 'fault' },
    24: { text: '电机异常', className: 'fault' },
    25: { text: '进水端异常', className: 'fault' },
    26: { text: '出水口异常', className: 'fault' },
    27: { text: '高压管漏水', className: 'fault' },
    28: { text: '外观异常', className: 'fault' },
    29: { text: '高压O形圈异常', className: 'fault' },
    30: { text: '其他异常', className: 'fault' },
    50: { text: '开枪跳动', className: 'fault' },
    51: { text: '关枪跳动', className: 'fault' },
  }
  return dictionary[errCode] ?? { text: `ErrCode ${errCode}`, className: 'fault' as const }
}

function workflowToLabel(workflow: number) {
  const dictionary: Record<number, string> = {
    0: '待命',
    1: '等待进水',
    2: '低压启动',
    3: '高压老化',
    4: '高压磨合',
    5: '常压磨合',
    6: '虹吸测试',
    7: '保压测试',
    8: '吹气清理',
  }
  return dictionary[workflow] ?? `未知流程(${workflow})`
}

function MiniSparkline({
  points,
  color,
}: {
  points: HistoryPoint[]
  color: string
}) {
  const normalized = normalizeTrend(points)
  const first = normalized[0]
  const last = normalized[normalized.length - 1]
  const smoothPath = normalized.length <= 1
    ? normalized.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
    : normalized.slice(1).reduce((path, point, index) => {
      const prev = normalized[index]
      const cx = ((prev.x + point.x) / 2).toFixed(2)
      const cy = ((prev.y + point.y) / 2).toFixed(2)
      return `${path} Q ${prev.x.toFixed(2)} ${prev.y.toFixed(2)}, ${cx} ${cy}`
    }, `M ${normalized[0].x.toFixed(2)} ${normalized[0].y.toFixed(2)}`)
  const areaPath = first && last ? `${smoothPath} L ${last.x.toFixed(2)} 44 L ${first.x.toFixed(2)} 44 Z` : ''

  return (
    <svg className="dashboard-sparkline" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true">
      {areaPath ? <path d={areaPath} fill={color} fillOpacity="0.16" /> : null}
      {smoothPath ? <path d={smoothPath} fill="none" stroke={color} strokeWidth="1.9" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" /> : null}
    </svg>
  )
}

function DashboardProgressRing({ percent, color = '#605af3' }: { percent: number; color?: string }) {
  const safePercent = Math.max(0, Math.min(100, percent))
  const radius = 34
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - safePercent / 100)

  return (
    <svg className="dashboard-ring" viewBox="0 0 96 96" aria-hidden="true">
      <circle className="dashboard-ring-track" cx="48" cy="48" r={radius} />
      <circle className="dashboard-ring-value" cx="48" cy="48" r={radius} stroke={color} strokeDasharray={circumference} strokeDashoffset={dashOffset} />
      <text x="48" y="51" textAnchor="middle">
        {safePercent}%
      </text>
    </svg>
  )
}

function DashboardDualProgressRing({ percent, positive, negative }: { percent: number; positive: string; negative: string }) {
  const safePercent = Math.max(0, Math.min(100, percent))
  const radius = 34
  const circumference = 2 * Math.PI * radius
  const positiveLength = circumference * (safePercent / 100)
  const negativeLength = circumference - positiveLength

  return (
    <svg className="dashboard-ring" viewBox="0 0 96 96" aria-hidden="true">
      <circle className="dashboard-ring-track" cx="48" cy="48" r={radius} />
      <circle
        cx="48"
        cy="48"
        r={radius}
        fill="none"
        stroke={positive}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${positiveLength} ${circumference}`}
        transform="rotate(-90 48 48)"
      />
      <circle
        cx="48"
        cy="48"
        r={radius}
        fill="none"
        stroke={negative}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${negativeLength} ${circumference}`}
        strokeDashoffset={-positiveLength}
        transform="rotate(-90 48 48)"
      />
      <text x="48" y="51" textAnchor="middle">
        {safePercent}%
      </text>
    </svg>
  )
}

function draftFromBrowse(deviceId: string, deviceName: string, node: BrowseNode): TagFormState {
  const displayName = getDisplayName(node.nodeId)
  const match = displayName.match(/HMI_DB\.(?:HMI_Faceplates|Faceplates)\[(\d+)\]/i)
  return { deviceId, nodeId: node.nodeId, browseName: node.browseName || node.displayName, displayName, dataType: node.dataType ?? 'Unknown', samplingIntervalMs: 200, publishingIntervalMs: 200, allowWrite: node.writable, enabled: true, groupKey: match ? `${deviceName}_HMI${match[1]}` : '未分组' }
}

function draftFromTag(tag: TagDefinition, deviceName: string): TagFormState {
  return { id: tag.id, deviceId: tag.deviceId, nodeId: tag.nodeId, browseName: tag.browseName, displayName: tag.displayName, dataType: tag.dataType, samplingIntervalMs: tag.samplingIntervalMs, publishingIntervalMs: tag.publishingIntervalMs, allowWrite: tag.allowWrite, enabled: tag.enabled, groupKey: tag.groupKey ?? getResolvedGroup(deviceName, tag) }
}

function App() {
  const [view, setView] = useState<ViewKey>(getInitialView)
  const [runtime, setRuntime] = useState<RuntimeOverview>({ devices: [], tags: [], snapshots: [] })
  const [devices, setDevices] = useState<DeviceConnection[]>([])
  const [tagRows, setTagRows] = useState<TagDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [savingTagId, setSavingTagId] = useState<string | null>(null)
  const [savingBatch, setSavingBatch] = useState(false)
  const [savingDeviceId, setSavingDeviceId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState('系统已就绪')
  const [groupFilter, setGroupFilter] = useState('all')
  const [writeDrafts, setWriteDrafts] = useState<Record<string, string>>({})
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [browserSearch, setBrowserSearch] = useState('')
  const [expandedBrowseNodes, setExpandedBrowseNodes] = useState<Record<string, boolean>>({})
  const [browseCache, setBrowseCache] = useState<Record<string, BrowseNode[]>>({})
  const [selectedBrowseNodes, setSelectedBrowseNodes] = useState<BrowseNode[]>([])
  const [batchDrafts, setBatchDrafts] = useState<TagFormState[]>([])
  const [deviceForm, setDeviceForm] = useState<DeviceFormState>(blankDeviceForm())
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null)
  const [dashboardTrendByFaceplate, setDashboardTrendByFaceplate] = useState<Record<number, FaceplateTrend>>({
    1: { pressure: [], flow: [] },
    2: { pressure: [], flow: [] },
  })

  const runtimeNameById = useMemo(() => Object.fromEntries(runtime.devices.map((d) => [d.deviceId, d.deviceName])), [runtime.devices])
  const runtimeDeviceStatusById = useMemo(() => Object.fromEntries(runtime.devices.map((d) => [d.deviceId, d.status])), [runtime.devices])
  const deviceNameById = useMemo(() => Object.fromEntries(devices.map((d) => [d.id, d.name])), [devices])
  const snapshotByTagId = useMemo(() => new Map(runtime.snapshots.map((snapshot) => [snapshot.tagId, snapshot])), [runtime.snapshots])
  const activeDeviceId = selectedDeviceId || devices[0]?.id || runtime.devices[0]?.deviceId || ''
  const activeDeviceName = deviceNameById[activeDeviceId] || runtimeNameById[activeDeviceId] || '当前设备'
  const rootBrowseKey = `${activeDeviceId}|__root__`
  const rootBrowseNodes = browseCache[rootBrowseKey] ?? []
  const selectedDeviceTags = useMemo(() => tagRows.filter((tag) => tag.deviceId === activeDeviceId), [activeDeviceId, tagRows])
  const batchRows = batchDrafts.length > 0 ? batchDrafts : selectedDeviceTags.map((tag) => draftFromTag(tag, activeDeviceName))
  const groups = useMemo(() => {
    const unique = new Set<string>(['all'])
    for (const tag of runtime.tags) unique.add(getResolvedGroup(runtimeNameById[tag.deviceId] ?? '', tag))
    return Array.from(unique)
  }, [runtime.tags, runtimeNameById])

  function faceplatePathPrefix(faceplateIndex: number) {
    return new RegExp(`^HMI_DB\\.(?:HMI_Faceplates|Faceplates)\\[${faceplateIndex}\\]\\.`, 'i')
  }

  function faceplateBarcodePattern(faceplateIndex: number) {
    return new RegExp(`^HMI_DB\\.barcode\\[${faceplateIndex}\\]$`, 'i')
  }

  function shortLabelForFaceplate(tag: TagDefinition, faceplateIndex: number) {
    const displayName = getDisplayName(tag.nodeId)
    const faceplatePrefix = faceplatePathPrefix(faceplateIndex)
    if (faceplatePrefix.test(displayName)) return displayName.replace(faceplatePrefix, '')
    if (faceplateBarcodePattern(faceplateIndex).test(displayName)) return 'barcode'
    return displayName
  }

  const dashboardTagsByFaceplate = useMemo(() => {
    const result: Record<number, TagDefinition[]> = {}
    for (const index of dashboardFaceplateIndexes) {
      const prefix = faceplatePathPrefix(index)
      const barcodePattern = faceplateBarcodePattern(index)
      result[index] = runtime.tags.filter((tag) => {
        const displayName = getDisplayName(tag.nodeId)
        return prefix.test(displayName) || barcodePattern.test(displayName)
      })
    }
    return result
  }, [dashboardFaceplateIndexes, runtime.tags])

  const dashboardTagMapByFaceplate = useMemo(() => {
    const result: Record<number, Map<string, TagDefinition>> = {}
    for (const index of dashboardFaceplateIndexes) {
      result[index] = new Map(
        (dashboardTagsByFaceplate[index] ?? []).map((tag) => [shortLabelForFaceplate(tag, index).toLowerCase(), tag] as const),
      )
    }
    return result
  }, [dashboardFaceplateIndexes, dashboardTagsByFaceplate])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      setDashboardTrendByFaceplate((current) => {
        const next: Record<number, FaceplateTrend> = { ...current }
        for (const index of dashboardFaceplateIndexes) {
          const map = dashboardTagMapByFaceplate[index]
          const tags = dashboardTagsByFaceplate[index] ?? []
          const pressureTag = map.get('pressure') ?? tags.find((item) => /pressure|press/i.test(shortLabelForFaceplate(item, index)))
          const flowTag = map.get('flow') ?? tags.find((item) => /flow/i.test(shortLabelForFaceplate(item, index)))
          const pressureValue = toNumericValue(pressureTag ? snapshotByTagId.get(pressureTag.id)?.value ?? null : null)
          const flowValue = toNumericValue(flowTag ? snapshotByTagId.get(flowTag.id)?.value ?? null : null)
          const keepAfter = now - 120_000
          const trend = current[index] ?? { pressure: [], flow: [] }
          next[index] = {
            pressure: [...trend.pressure, { ts: now, value: pressureValue ?? 0 }].filter((item) => item.ts >= keepAfter),
            flow: [...trend.flow, { ts: now, value: flowValue ?? 0 }].filter((item) => item.ts >= keepAfter),
          }
        }
        return next
      })
    }, 500)
    return () => window.clearInterval(timer)
  }, [dashboardFaceplateIndexes, dashboardTagMapByFaceplate, dashboardTagsByFaceplate, snapshotByTagId])

  function dashboardField(faceplateIndex: number, name: string, fallbackPattern?: RegExp): DashboardField {
    const tags = dashboardTagsByFaceplate[faceplateIndex] ?? []
    const tagMap = dashboardTagMapByFaceplate[faceplateIndex]
    const tag =
      tagMap.get(name.toLowerCase()) ??
      (fallbackPattern ? tags.find((item) => fallbackPattern.test(shortLabelForFaceplate(item, faceplateIndex).toLowerCase())) : undefined)
    const key = name.toLowerCase()
    const digitsMap: Record<string, number> = {
      voltage: 1,
      current: 2,
      pressure: 2,
      inletpressure: 1,
      flow: 1,
      power: 0,
    }
    const snapshot = tag ? snapshotByTagId.get(tag.id) : undefined
    const numeric = toNumericValue(snapshot?.value ?? null)
    return {
      tag,
      snapshot,
      numeric,
      text: formatNumberWithUnit(numeric, inferUnit(name), digitsMap[key]),
    }
  }

  const dashboardDataList = useMemo(() => {
    return dashboardFaceplateIndexes.map((faceplateIndex) => {
    const pressure = dashboardField(faceplateIndex, 'pressure', /pressure|press/)
    const flow = dashboardField(faceplateIndex, 'flow', /flow/)
    const inletPressure = dashboardField(faceplateIndex, 'inletpressure', /inletpressure|inletpress/)
    const inletTemp = dashboardField(faceplateIndex, 'inlettemp', /inlettemp|temperature|temp/)
    const voltage = dashboardField(faceplateIndex, 'voltage', /voltage/)
    const current = dashboardField(faceplateIndex, 'current', /current/)
    const frequency = dashboardField(faceplateIndex, 'frequency', /frequency|freq/)
    const power = dashboardField(faceplateIndex, 'power', /power$/)
    const passNumber = dashboardField(faceplateIndex, 'passnumber', /passnumber/)
    const failNumber = dashboardField(faceplateIndex, 'failnumber', /failnumber/)
    const errCode = dashboardField(faceplateIndex, 'errcode', /errcode/)
    const workFlow = dashboardField(faceplateIndex, 'workflow', /workflow/)
    const enduranceProcess = dashboardField(faceplateIndex, 'enduranceprocess', /enduranceprocess/)
    const triggerOn = dashboardField(faceplateIndex, 'triggeronprocess', /triggeronprocess/)
    const triggerOff = dashboardField(faceplateIndex, 'triggeroffprocess', /triggeroffprocess/)
    const lastTimeHour = dashboardField(faceplateIndex, 'lasttimehour', /lasttimehour/)
    const lastTimeMinute = dashboardField(faceplateIndex, 'lasttimeminute', /lasttimeminute/)
    const stationNumber = dashboardField(faceplateIndex, 'stationnumber', /stationnumber/)
    const barcode = dashboardField(faceplateIndex, 'barcode', /barcode/)
    const now = Date.now()
    const faceplateTrend = dashboardTrendByFaceplate[faceplateIndex] ?? { pressure: [], flow: [] }
    const pressureSeries = faceplateTrend.pressure.length > 0 ? faceplateTrend.pressure : [{ ts: now, value: pressure.numeric ?? 0 }]
    const flowSeries = faceplateTrend.flow.length > 0 ? faceplateTrend.flow : [{ ts: now, value: flow.numeric ?? 0 }]
    const endurancePercent = Math.max(0, Math.min(100, Math.round(enduranceProcess.numeric ?? 0)))
    const triggerOnPercent = Math.max(0, Math.min(100, Math.round(triggerOn.numeric ?? 0)))
    const triggerOffPercent = Math.max(0, Math.min(100, Math.round(triggerOff.numeric ?? 0)))
    const factoryTotal = (passNumber.numeric ?? 0) + (failNumber.numeric ?? 0)
    const passPercent = factoryTotal > 0 ? Math.round(((passNumber.numeric ?? 0) / factoryTotal) * 100) : 0
    const failPercent = factoryTotal > 0 ? Math.round(((failNumber.numeric ?? 0) / factoryTotal) * 100) : 0
    const status = errCodeToStatus(Math.round(errCode.numeric ?? 0))
    const workflowValue = Math.round(workFlow.numeric ?? 0)
    const workflowText = workflowToLabel(workflowValue)
    const workflowClass = workflowValue === 0 ? 'standby' : 'running'
    const enduranceMode = dashboardField(faceplateIndex, 'automode0_factory1_endurance', /automode0[_]?factory1[_]?endurance/)
    const showEnduranceCard = Math.round(enduranceMode.numeric ?? 0) > 0
    const enduranceDuration = `${Math.max(0, lastTimeHour.numeric ?? 0)}h ${Math.max(0, lastTimeMinute.numeric ?? 0)}min`
    const faceplateTags = dashboardTagsByFaceplate[faceplateIndex] ?? []
    const hasConnectedDevice = faceplateTags.some((tag) => {
      const deviceState = (runtimeDeviceStatusById[tag.deviceId] ?? '').toLowerCase()
      return (deviceState.includes('connect') || deviceState === '') && !deviceState.includes('dis')
    })
    const hasGoodSnapshot = faceplateTags.some((tag) => {
      const snapshot = snapshotByTagId.get(tag.id)
      if (!snapshot) return false
      const q = (snapshot.quality ?? '').toLowerCase()
      const s = (snapshot.connectionState ?? '').toLowerCase()
      const qualityOk = q === '' || q === 'good' || q === '0' || q === '00000000' || q === '0000000'
      const stateOk = s === '' || s.includes('connect')
      return qualityOk && stateOk
    })
    const faceplateDeviceStatuses = Array.from(
      new Set(faceplateTags.map((tag) => (runtimeDeviceStatusById[tag.deviceId] ?? '').toLowerCase()).filter((value) => value !== '')),
    )
    const hasDeviceDisconnecting = faceplateDeviceStatuses.some((status) =>
      status.includes('reconnect') || status.includes('disconnect') || status.includes('offline') || status.includes('fault') || status.includes('error'),
    )
    const connected = !hasDeviceDisconnecting && (hasConnectedDevice || hasGoodSnapshot)
    const boardHeadClass =
      !connected
        ? 'disconnected'
        : (errCode.numeric ?? 0) > 0
          ? 'fault'
          : (workFlow.numeric ?? 0) > 0
            ? 'connected'
            : 'standby'

    return {
      faceplateIndex,
      available: (dashboardTagsByFaceplate[faceplateIndex] ?? []).length > 0,
      title: stationNumber.numeric !== null ? `工位${stationNumber.numeric}` : `工位${faceplateIndex}`,
      stationText:
        barcode.snapshot?.value === null || barcode.snapshot?.value === undefined
          ? '-'
          : String(barcode.snapshot.value).trim() || '-',
      deviceStatus: connected ? `Connected / ${status.text}` : 'Disconnected',
      boardHeadClass,
      risk: { label: status.className === 'normal' ? '正常' : '异常', className: status.className },
      statusText: status.text,
      workflowText,
      workflowClass,
      pressure,
      flow,
      inletPressure,
      inletTemp,
      voltage,
      current,
      frequency,
      power,
      passNumber,
      failNumber,
      errCode,
      enduranceProcess,
      triggerOn,
      triggerOff,
      pressureSeries,
      flowSeries,
      endurancePercent,
      passPercent,
      failPercent,
      showEnduranceCard,
      enduranceDuration,
      triggerOnPercent,
      triggerOffPercent,
    }
  })
  }, [dashboardFaceplateIndexes, dashboardTagsByFaceplate, dashboardTrendByFaceplate, runtimeDeviceStatusById, snapshotByTagId])

  const filteredRuntimeTags = useMemo(() => {
    const tags = runtime.tags.filter((tag) => {
      const group = getResolvedGroup(runtimeNameById[tag.deviceId] ?? '', tag)
      return groupFilter === 'all' || group === groupFilter
    })

    return [...tags].sort((left, right) => {
      const leftGroup = getResolvedGroup(runtimeNameById[left.deviceId] ?? '', left)
      const rightGroup = getResolvedGroup(runtimeNameById[right.deviceId] ?? '', right)
      const groupCompare = leftGroup.localeCompare(rightGroup, 'zh-CN', { numeric: true, sensitivity: 'base' })
      if (groupCompare !== 0) return groupCompare

      return getDisplayName(left.nodeId).localeCompare(getDisplayName(right.nodeId), 'zh-CN', { numeric: true, sensitivity: 'base' })
    })
  }, [groupFilter, runtime.tags, runtimeNameById])

  const runtimeRows = useMemo(() => {
    return filteredRuntimeTags.map((tag, index) => {
      const snapshot = snapshotByTagId.get(tag.id)
      const stat = statusOf(snapshot, runtimeDeviceStatusById[tag.deviceId])
      const group = getResolvedGroup(runtimeNameById[tag.deviceId] ?? '', tag)
      const value = formatValue(tag, snapshot)
      return {
        risk: index + 1,
        tag,
        snapshot,
        stat,
        group,
        value,
        time: compactTimeText(snapshot),
      }
    })
  }, [filteredRuntimeTags, runtimeDeviceStatusById, runtimeNameById, snapshotByTagId])

  async function openVnc(faceplateIndex: number) {
    const hostByFaceplate: Record<number, string> = {
      1: '192.168.88.11',
      2: '192.168.88.12',
    }
    const host = hostByFaceplate[faceplateIndex]
    if (!host) return
    try {
      const result = await openVncTool(host, '111111')
      setStatusMessage(result.message || `已尝试打开 RealVNC: ${host}:5900`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : `打开 RealVNC 失败: ${host}:5900`)
    }
  }

  async function loadWorkspace() {
    try {
      setLoading(true)
      const [overview, deviceList, tags] = await Promise.all([getRuntimeOverview(), getDevices(), getTags()])
      setRuntime(overview)
      setDevices(deviceList)
      setTagRows(tags)
      if (!selectedDeviceId && deviceList[0]) setSelectedDeviceId(deviceList[0].id)
      setStatusMessage('数据已刷新')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function refreshRuntime() {
    try {
      setLoading(true)
      const overview = await getRuntimeOverview()
      setRuntime(overview)
      setStatusMessage('监控数据已刷新')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '刷新失败')
    } finally {
      setLoading(false)
    }
  }

  async function loadBrowse(deviceId: string, nodeId: string | null) {
    if (!deviceId) return
    const key = `${deviceId}|${nodeId ?? '__root__'}`
    if (browseCache[key]) return
    try {
      setBrowseCache((current) => ({ ...current, [key]: [] }))
      setBrowseCache((current) => ({ ...current, [key]: [] }))
      const nodes = await browseDevice(deviceId, nodeId ?? undefined)
      setBrowseCache((current) => ({ ...current, [key]: nodes }))
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '浏览目录失败')
    }
  }

  useEffect(() => { void loadWorkspace() }, [])

  useEffect(() => {
    const connection = new HubConnectionBuilder().withUrl('/hubs/realtime').withAutomaticReconnect().configureLogging(LogLevel.Information).build()
    connection.on('tagSnapshotUpdated', (snapshot: TagSnapshot) => {
      setRuntime((current) => ({ ...current, snapshots: [...current.snapshots.filter((item) => item.tagId !== snapshot.tagId), snapshot] }))
    })
    connection.on('deviceStatusChanged', (event: { deviceId: string; status: string; message: string }) => {
      setRuntime((current) => ({ ...current, devices: current.devices.map((device) => (device.deviceId === event.deviceId ? { ...device, status: event.status } : device)) }))
      setStatusMessage(event.message || '设备状态已更新')
    })
    void connection.start().catch(() => setStatusMessage('实时连接未建立，当前显示缓存数据'))
    return () => { void connection.stop() }
  }, [])

  useEffect(() => { if (!selectedDeviceId && activeDeviceId) setSelectedDeviceId(activeDeviceId) }, [activeDeviceId, selectedDeviceId])
  useEffect(() => {
    if (!activeDeviceId) return
    setExpandedBrowseNodes({})
    setSelectedBrowseNodes([])
    void loadBrowse(activeDeviceId, null)
  }, [activeDeviceId])
  useEffect(() => { if (view !== 'batch' || batchDrafts.length > 0 || !activeDeviceId) return; const drafts = selectedDeviceTags.map((tag) => draftFromTag(tag, activeDeviceName)); if (drafts.length) setBatchDrafts(drafts) }, [activeDeviceId, activeDeviceName, batchDrafts.length, selectedDeviceTags, view])

  async function handleWrite(tagId: string) {
    const value = writeDrafts[tagId]
    if (value === undefined || value.trim() === '') return setStatusMessage('请输入要写入的值')
    try {
      setSavingTagId(tagId)
      await writeTag(tagId, value)
      setWriteDrafts((current) => ({ ...current, [tagId]: '' }))
      setStatusMessage('写入成功')
      await refreshRuntime()
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '写入失败')
    } finally {
      setSavingTagId(null)
    }
  }

  async function handleSaveDevice() {
    try {
      setSavingDeviceId(editingDeviceId ?? 'new')
      const payload: DeviceFormState = { ...deviceForm, authMode: 'Anonymous', username: '', password: '' }
      if (editingDeviceId) {
        await updateDevice(editingDeviceId, payload)
        setStatusMessage('设备已更新')
      } else {
        await createDevice(payload)
        setStatusMessage('设备已创建')
      }
      setEditingDeviceId(null)
      setDeviceForm(blankDeviceForm())
      await loadWorkspace()
      await refreshRuntime()
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '设备保存失败')
    } finally {
      setSavingDeviceId(null)
    }
  }

  function editDevice(device: DeviceConnection) {
    setEditingDeviceId(device.id)
    setSelectedDeviceId(device.id)
    setDeviceForm({ name: device.name, endpointUrl: device.endpointUrl, securityMode: device.securityMode || 'None', securityPolicy: device.securityPolicy || 'None', authMode: device.authMode || 'Anonymous', username: device.username ?? '', password: '', autoConnect: device.autoConnect })
    setView('devices')
  }

  async function connect(id: string) { try { setSavingDeviceId(id); await connectDevice(id); await loadWorkspace(); await refreshRuntime(); setStatusMessage('连接命令已发送') } catch (error) { setStatusMessage(error instanceof Error ? error.message : '连接失败') } finally { setSavingDeviceId(null) } }
  async function disconnect(id: string) { try { setSavingDeviceId(id); await disconnectDevice(id); await loadWorkspace(); await refreshRuntime(); setStatusMessage('断开命令已发送') } catch (error) { setStatusMessage(error instanceof Error ? error.message : '断开失败') } finally { setSavingDeviceId(null) } }

  function toggleFolder(node: BrowseNode) {
    setExpandedBrowseNodes((current) => {
      const nextExpanded = !current[node.nodeId]
      void loadBrowse(activeDeviceId, node.nodeId)
      return { ...current, [node.nodeId]: nextExpanded }
    })
  }

  function toggleBrowse(node: BrowseNode) {
    if (node.hasChildren) {
      toggleFolder(node)
      return
    }

    setSelectedBrowseNodes((current) =>
      current.some((item) => item.nodeId === node.nodeId)
        ? current.filter((item) => item.nodeId !== node.nodeId)
        : [...current, node],
    )
  }

  function addSelectionToBatch() {
    if (!activeDeviceId || selectedBrowseNodes.length === 0) return setStatusMessage('请先勾选要配置的变量')
    setBatchDrafts((current) => {
      const map = new Map(current.map((item) => [item.nodeId, item]))
      for (const node of selectedBrowseNodes) map.set(node.nodeId, draftFromBrowse(activeDeviceId, activeDeviceName, node))
      return Array.from(map.values())
    })
    setSelectedBrowseNodes([])
    setStatusMessage(`已加入 ${selectedBrowseNodes.length} 个变量到批量配置`)
    setView('batch')
  }

  function loadDeviceTagsToBatch() { setBatchDrafts(selectedDeviceTags.map((tag) => draftFromTag(tag, activeDeviceName))); setStatusMessage(`已载入 ${selectedDeviceTags.length} 个已订阅变量`) }
  function clearBatchDrafts() { setBatchDrafts([]); setStatusMessage('已清空批量配置列表') }
  function applyBatchDefaults() { setBatchDrafts((current) => current.map((row) => ({ ...row, displayName: row.displayName.trim() || getDisplayName(row.nodeId), groupKey: row.groupKey?.trim() || '未分组', samplingIntervalMs: row.samplingIntervalMs || 200, publishingIntervalMs: row.publishingIntervalMs || 200, enabled: true }))); setStatusMessage('默认规则已应用') }
  function updateBatchRow(index: number, patch: Partial<TagFormState>) { setBatchDrafts((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row))) }

  async function saveBatch() {
    if (batchRows.length === 0) return setStatusMessage('没有可保存的变量')
    try {
      setSavingBatch(true)
      for (const row of batchRows) {
        const payload: TagFormState = { ...row, displayName: row.displayName.trim() || getDisplayName(row.nodeId), groupKey: row.groupKey?.trim() || '未分组', samplingIntervalMs: Number(row.samplingIntervalMs) || 200, publishingIntervalMs: Number(row.publishingIntervalMs) || 200, allowWrite: Boolean(row.allowWrite), enabled: Boolean(row.enabled) }
        if (row.id) await updateTag(row.id, payload); else await createTag(payload)
      }
      await loadWorkspace(); await refreshRuntime(); setBatchDrafts((await getTags()).filter((tag) => tag.deviceId === activeDeviceId).map((tag) => draftFromTag(tag, activeDeviceName))); setStatusMessage('批量保存成功')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '批量保存失败')
    } finally { setSavingBatch(false) }
  }

  async function deleteBatchRow(row: TagFormState, index: number) {
    try {
      if (row.id) { await deleteTag(row.id); await loadWorkspace(); await refreshRuntime() }
      setBatchDrafts((current) => current.filter((_, i) => i !== index))
      setStatusMessage('变量已删除')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '删除失败')
    }
  }

  function editRuntimeTag(tag: TagDefinition) { const deviceName = runtimeNameById[tag.deviceId] || activeDeviceName; setSelectedDeviceId(tag.deviceId); setBatchDrafts([draftFromTag(tag, deviceName)]); setView('batch') }
  async function removeRuntimeTag(id: string) { try { await deleteTag(id); await loadWorkspace(); await refreshRuntime(); setStatusMessage('订阅变量已删除') } catch (error) { setStatusMessage(error instanceof Error ? error.message : '删除失败') } }
  const runtimePage = (
    <section className="runtime-shell">
      <aside className="runtime-sidebar">
        <div className="runtime-brand">
          <div className="runtime-brand-mark">SCADA</div>
        </div>
        <nav className="runtime-sidebar-nav" aria-label="主导航">
          {sidebarItems.map((item) => (
            <button
              key={item.key}
              type="button"
              className={view === item.key ? 'runtime-nav active' : 'runtime-nav'}
              onClick={() => setView(item.key)}
            >
              <span className="runtime-nav-icon">{item.icon}</span>
              <span className="runtime-nav-label">{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="runtime-content">
        <header className="runtime-topbar">
          <div className="runtime-title-wrap">
            <h1>清洗机测试系统</h1>
          </div>
          <div className="runtime-topbar-actions">
            <button type="button" className="icon-circle">◔</button>
            <button type="button" className="icon-circle">?</button>
            <div className="avatar-circle">SC</div>
          </div>
        </header>

        <section className="runtime-toolbar-row runtime-toolbar-row--compact">
          <div className="runtime-toolbar-meta">
            <span>{runtimeRows.length} 条变量</span>
            <span>{loading ? '刷新中' : statusMessage}</span>
          </div>
        </section>

        <section className="runtime-table-wrap">
          <div className="runtime-table-shell">
            <table className="runtime-table project-table">
              <colgroup>
                <col style={{ width: '54px' }} />
                <col style={{ width: '360px' }} />
                <col style={{ width: '92px' }} />
                <col style={{ width: '86px' }} />
                <col style={{ width: '164px' }} />
                <col style={{ width: '136px' }} />
                <col />
                <col style={{ width: '132px' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Risk</th>
                  <th>变量名称</th>
                  <th>当前值</th>
                  <th>状态</th>
                  <th>最新时间</th>
                  <th>
                    <div className="table-filter-head">
                      <span>分组</span>
                      <select className="header-filter" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} aria-label="按分组筛选">
                        <option value="all">全部</option>
                        {groups.filter((g) => g !== 'all').map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                  </th>
                  <th>NodeId</th>
                  <th>写入</th>
                </tr>
              </thead>
              <tbody>
                {runtimeRows.map(({ risk, tag, stat, group, value, time }) => {
                  return (
                    <tr key={tag.id}>
                      <td className="row-index">{risk}</td>
                      <td>
                        <div className="project-name">{tag.displayName}</div>
                      </td>
                      <td>
                        <div className="project-value">{value}</div>
                      </td>
                      <td>
                        <span className={`project-status ${stat.className === 'normal' ? 'green' : 'red'}`}>
                          <span className="dot" />
                          {stat.className === 'normal' ? 'OK' : 'NG'}
                        </span>
                      </td>
                      <td className="time-cell">{time}</td>
                      <td>
                        <span className="project-pill">{group}</span>
                      </td>
                      <td className="subtle">{tag.nodeId}</td>
                      <td>
                        {tag.allowWrite ? (
                          <div className="write-cell">
                            <input
                              value={writeDrafts[tag.id] ?? ''}
                              onChange={(e) => setWriteDrafts((current) => ({ ...current, [tag.id]: e.target.value }))}
                              placeholder={value}
                            />
                            <button type="button" className="write-mini" onClick={() => void handleWrite(tag.id)} disabled={savingTagId === tag.id}>
                              {savingTagId === tag.id ? '...' : '写入'}
                            </button>
                          </div>
                        ) : (
                          <span className="subtle">只读</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </section>
  )

  const dashboardPage = (
    <section className="dashboard-shell">
      <header className="dashboard-topbar">
        <div className="dashboard-topbar-title">
          <h1>清洗机测试系统</h1>
        </div>
        <div className="dashboard-topbar-meta">
          <span className="dashboard-topbar-pill normal">模板: HMI_DB.Faceplates[1] / [2]</span>
          <button type="button" className="dashboard-icon-button" aria-label="通知">
            •
          </button>
          <button type="button" className="dashboard-icon-button" aria-label="帮助">
            ?
          </button>
          <div className="dashboard-avatar">SC</div>
        </div>
      </header>

      <section className="dashboard-canvas">
        {dashboardDataList.some((item) => item.available) ? (
          <div className="dashboard-center">
            <div className="dashboard-template-grid">
            {dashboardDataList.map((dashboardData) => (
            <article key={`faceplate-${dashboardData.faceplateIndex}`} className="dashboard-board">
              <header className={`dashboard-board-head ${dashboardData.boardHeadClass}`}>
                <div className="dashboard-board-head-main">
                  <div className="dashboard-board-tag">{dashboardData.title}</div>
                </div>
                <button
                  type="button"
                  className="dashboard-vnc-button"
                  onClick={() => void openVnc(dashboardData.faceplateIndex)}
                  aria-label={`打开 VNC ${dashboardData.faceplateIndex}`}
                >
                  VNC
                </button>
              </header>

              <section className="dashboard-grid">
                <div className="dashboard-barcode-card">
                  <div className="dashboard-barcode-row">
                    <div className="dashboard-card-label">Barcode</div>
                    <div className="dashboard-barcode-value">{dashboardData.stationText}</div>
                  </div>
                </div>

                <div className="dashboard-inlet-card">
                  <div className="dashboard-card-label">Inlet</div>
                  <div className="dashboard-inlet-values inlet-stat-grid">
                    <div className="inlet-stat inlet-blue">
                      <span>Pressure</span>
                      <strong>{dashboardData.inletPressure.text}</strong>
                    </div>
                    <div className="inlet-stat inlet-yellow">
                      <span>Temperature</span>
                      <strong>{dashboardData.inletTemp.text}</strong>
                    </div>
                  </div>
                </div>

                <div className="dashboard-power-card">
                  <div className="dashboard-card-label">Power</div>
                  <div className="dashboard-power-grid">
                    <div className="power-stat power-blue">
                      <span>Voltage</span>
                      <strong>{dashboardData.voltage.text}</strong>
                    </div>
                    <div className="power-stat power-red">
                      <span>Current</span>
                      <strong>{dashboardData.current.text}</strong>
                    </div>
                    <div className="power-stat power-yellow">
                      <span>Frequency</span>
                      <strong>{dashboardData.frequency.text}</strong>
                    </div>
                    <div className="power-stat power-green">
                      <span>Power</span>
                      <strong>{dashboardData.power.text}</strong>
                    </div>
                  </div>
                </div>

                <div className="dashboard-mini-card pressure-card">
                  <div className="dashboard-mini-head">
                    <span>Pressure</span>
                    <strong>{dashboardData.pressure.text}</strong>
                  </div>
                  <MiniSparkline points={dashboardData.pressureSeries} color="#e05b61" />
                </div>

                <div className="dashboard-mini-card flow-card">
                  <div className="dashboard-mini-head">
                    <span>Flow</span>
                    <strong>{dashboardData.flow.text}</strong>
                  </div>
                  <MiniSparkline points={dashboardData.flowSeries} color="#0d6efd" />
                </div>
              </section>

                <section className="dashboard-lower-stack">
                  {dashboardData.showEnduranceCard ? (
                    <article className="dashboard-test-card">
                    <div className="dashboard-test-head">
                      <div className="dashboard-title-row">
                        <div className="dashboard-card-title">耐久测试</div>
                        <div className="dashboard-card-value">{dashboardData.enduranceDuration}</div>
                      </div>
                    </div>
                    <div className="dashboard-endurance-body">
                      <DashboardProgressRing percent={dashboardData.endurancePercent} color="#26a269" />
                      <div className="dashboard-bars">
                        <div className="dashboard-bar-row">
                          <div className="dashboard-bar-label">开枪</div>
                          <div className="dashboard-bar-track">
                            <div className="dashboard-bar-fill positive" style={{ width: `${dashboardData.triggerOnPercent}%` }} />
                          </div>
                        </div>
                        <div className="dashboard-bar-row">
                          <div className="dashboard-bar-label">关枪</div>
                          <div className="dashboard-bar-track">
                            <div className="dashboard-bar-fill negative" style={{ width: `${dashboardData.triggerOffPercent}%` }} />
                          </div>
                        </div>
                      </div>
                    </div>
                  </article>
                ) : (
                  <article className="dashboard-test-card">
                    <div className="dashboard-test-head">
                      <div className="dashboard-title-row">
                        <div className="dashboard-card-title">出厂测试</div>
                        <div className={`dashboard-card-value workflow-pill ${dashboardData.workflowClass}`}>{dashboardData.workflowText}</div>
                      </div>
                    </div>
                    <div className="dashboard-endurance-body">
                      <DashboardDualProgressRing percent={dashboardData.passPercent} positive="#6159f4" negative="#f08a7b" />
                      <div className="dashboard-bars">
                        <div className="dashboard-bar-row">
                          <div className="dashboard-bar-label">Pass</div>
                          <div className="dashboard-bar-track">
                            <div className="dashboard-bar-fill positive" style={{ width: `${dashboardData.passPercent}%` }} />
                          </div>
                          <strong>{dashboardData.passNumber.text}</strong>
                        </div>
                        <div className="dashboard-bar-row">
                          <div className="dashboard-bar-label">NG</div>
                          <div className="dashboard-bar-track">
                            <div className="dashboard-bar-fill negative" style={{ width: `${dashboardData.failPercent}%` }} />
                          </div>
                          <strong>{dashboardData.failNumber.text}</strong>
                        </div>
                      </div>
                    </div>
                    </article>
                  )}
                </section>

                <div className={`dashboard-alert ${dashboardData.risk.className}`}>
                  <span>{dashboardData.statusText}</span>
                </div>
              </article>
            ))}
            </div>
          </div>
        ) : (
          <div className="dashboard-empty-state">暂无 HMI_DB.Faceplates[1] / [2] 数据，请先确认点位订阅已恢复。</div>
        )}
      </section>
    </section>
  )
  function matchesBrowseNode(node: BrowseNode) {
    const keyword = browserSearch.trim().toLowerCase()
    if (!keyword) return true
    return [node.displayName, node.browseName, node.nodeId, node.dataType ?? ''].some((item) => item.toLowerCase().includes(keyword))
  }

  function renderBrowseTree(parentNodeId: string | null, level = 0): ReactNode[] {
    const key = `${activeDeviceId}|${parentNodeId ?? '__root__'}`
    const nodes = browseCache[key] ?? []
    return nodes.flatMap((node) => {
      const matches = matchesBrowseNode(node)
      const expanded = Boolean(expandedBrowseNodes[node.nodeId])
      const children = node.hasChildren && expanded ? renderBrowseTree(node.nodeId, level + 1) : []

      if (!matches && children.length === 0) {
        return []
      }

      const isLeaf = !node.hasChildren
      const checked = selectedBrowseNodes.some((item) => item.nodeId === node.nodeId)

      return [
        <div key={node.nodeId} className={`tree-row ${isLeaf ? 'leaf' : 'branch'}`} style={{ paddingLeft: `${level * 22 + 8}px` }}>
          <div className="tree-toggle" aria-hidden="true">
            {isLeaf ? (
              <input type="checkbox" checked={checked} onChange={() => toggleBrowse(node)} aria-label={node.displayName} />
            ) : (
              <button type="button" className="tree-toggle-icon" onClick={() => toggleBrowse(node)} aria-label={`${expanded ? '收起' : '展开'} ${node.displayName}`}>
                {expanded ? '−' : '+'}
              </button>
            )}
          </div>
          <div className="tree-content">
            <button type="button" className="tree-name" onClick={() => toggleBrowse(node)}>
              {node.displayName}
            </button>
            <div className="tree-meta">
              <span>{node.browseName}</span>
              <span>{node.nodeClass}</span>
              <span>{node.dataType ?? '—'}</span>
            </div>
          </div>
          <div className="tree-nodeid">{node.nodeId}</div>
        </div>,
        ...children,
      ]
    })
  }

  const tagsPage = (
    <section className="page-shell">
      <header className="page-header">
        <div className="page-copy">
          <h1>变量订阅</h1>
          <p>逐级浏览 OPC UA 目录，勾选叶子变量后进入批量配置</p>
        </div>
        <div className="page-meta">
          <span className="status-line">{activeDeviceName} · {selectedBrowseNodes.length} 个已勾选</span>
          <button type="button" className="soft-action" onClick={() => void loadWorkspace()} disabled={loading}>
            {loading ? '刷新中' : '刷新'}
          </button>
        </div>
      </header>

      <section className="toolbar-row tags-toolbar">
        <select value={activeDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)}>
          <option value="">选择设备</option>
          {devices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </select>
        <input value={browserSearch} onChange={(e) => setBrowserSearch(e.target.value)} placeholder="搜索目录 / 变量 / NodeId" />
        <button type="button" className="soft-action" onClick={() => setExpandedBrowseNodes({})}>
          折叠全部
        </button>
        <button type="button" className="soft-action" onClick={() => void loadBrowse(activeDeviceId, null)}>
          刷新目录
        </button>
        <button type="button" className="soft-action" onClick={() => setSelectedBrowseNodes([])}>
          清空勾选
        </button>
        <button type="button" className="primary-action" onClick={addSelectionToBatch}>
          加入批量配置
        </button>
      </section>

      <section className="content-strip tags-layout">
        <div className="browser-panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">目录树</div>
              <div className="panel-subtitle">目录节点展开显示，叶子节点才允许勾选</div>
            </div>
            <span className="status-line">当前只看这个目录下的内容</span>
          </div>
          <div className="tree-shell">{rootBrowseNodes.length === 0 ? <div className="empty-note">暂无目录数据</div> : renderBrowseTree(null)}</div>
        </div>

        <div className="detail-column">
          <section className="detail-panel">
            <div className="panel-head">
              <div>
                <div className="panel-title">待批量配置</div>
                <div className="panel-subtitle">勾选后统一修改显示名称与分组</div>
              </div>
              <button type="button" className="primary-action" onClick={addSelectionToBatch}>
                加入批量配置
              </button>
            </div>
            <div className="mini-list">
              {selectedBrowseNodes.length === 0 ? (
                <div className="empty-note">当前没有勾选变量</div>
              ) : (
                selectedBrowseNodes.map((node) => (
                  <div key={node.nodeId} className="mini-row">
                    <div>
                      <strong>{getDisplayName(node.nodeId)}</strong>
                      <span>{node.nodeId}</span>
                    </div>
                    <button type="button" className="mini-button" onClick={() => toggleBrowse(node)}>
                      移除
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="detail-panel">
            <div className="panel-head">
              <div>
                <div className="panel-title">已订阅变量</div>
                <div className="panel-subtitle">当前设备下的已配置点位</div>
              </div>
              <span className="status-line">{selectedDeviceTags.length} 个</span>
            </div>
            <div className="table-shell compact-shell">
              <div className="table-scroll">
                <table className="list-table">
                  <colgroup>
                    <col />
                    <col style={{ width: '100px' }} />
                    <col style={{ width: '100px' }} />
                    <col style={{ width: '132px' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>分组</th>
                      <th>写入</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedDeviceTags.map((tag) => (
                      <tr key={tag.id} className="list-row">
                        <td>
                          <strong>{tag.displayName}</strong>
                          <div className="node-meta">{tag.nodeId}</div>
                        </td>
                        <td>{getResolvedGroup(activeDeviceName, tag)}</td>
                        <td>{tag.allowWrite ? '可写' : '只读'}</td>
                        <td>
                          <div className="row-actions">
                            <button type="button" className="mini-button" onClick={() => editRuntimeTag(tag)}>
                              编辑
                            </button>
                            <button type="button" className="mini-button danger" onClick={() => void removeRuntimeTag(tag.id)}>
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </section>

      <div className="toast-line">{statusMessage}</div>
    </section>
  )
  const batchPage = (
    <section className="page-shell">
      <header className="page-header"><div className="page-copy"><h1>批量配置</h1><p>统一修改变量显示名称、分组和订阅参数后一次性保存</p></div><div className="page-meta"><span className="status-line">{activeDeviceName} · {batchRows.length} 条待配置</span><button type="button" className="soft-action" onClick={() => void loadWorkspace()} disabled={loading}>{loading ? '刷新中' : '刷新'}</button></div></header>
      <section className="toolbar-row batch-toolbar"><select value={activeDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)}><option value="">选择设备</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select><input value={browserSearch} onChange={(e) => setBrowserSearch(e.target.value)} placeholder="搜索名称 / NodeId / 分组" /><button type="button" className="soft-action" onClick={loadDeviceTagsToBatch}>载入当前设备变量</button><button type="button" className="soft-action" onClick={applyBatchDefaults}>应用默认规则</button><button type="button" className="soft-action" onClick={clearBatchDrafts}>清空列表</button><button type="button" className="primary-action" onClick={() => void saveBatch()} disabled={savingBatch}>{savingBatch ? '保存中' : '保存全部'}</button></section>
      <section className="content-strip batch-content"><div className="panel-head"><div><div className="panel-title">变量明细</div><div className="panel-subtitle">按行编辑，保存后立即刷新订阅</div></div><span className="status-line">默认采样 / 发布周期 200ms</span></div><div className="table-shell batch-shell"><div className="table-scroll"><table className="runtime-table batch-table"><colgroup><col style={{ width: '250px' }} /><col style={{ width: '230px' }} /><col style={{ width: '120px' }} /><col style={{ width: '120px' }} /><col style={{ width: '96px' }} /><col style={{ width: '96px' }} /><col /><col style={{ width: '120px' }} /></colgroup><thead><tr><th>显示名称</th><th>分组</th><th>采样</th><th>发布</th><th>写入</th><th>启用</th><th>NodeId</th><th>操作</th></tr></thead><tbody>{batchRows.map((row, index) => <tr key={row.id ?? `${row.nodeId}-${index}`}><td><input value={row.displayName} onChange={(e) => updateBatchRow(index, { displayName: e.target.value })} placeholder="显示名称" /></td><td><input value={row.groupKey} onChange={(e) => updateBatchRow(index, { groupKey: e.target.value })} placeholder="分组" /></td><td><input type="number" value={row.samplingIntervalMs} onChange={(e) => updateBatchRow(index, { samplingIntervalMs: Number(e.target.value) || 200 })} /></td><td><input type="number" value={row.publishingIntervalMs} onChange={(e) => updateBatchRow(index, { publishingIntervalMs: Number(e.target.value) || 200 })} /></td><td><input type="checkbox" checked={row.allowWrite} onChange={(e) => updateBatchRow(index, { allowWrite: e.target.checked })} /></td><td><input type="checkbox" checked={row.enabled} onChange={(e) => updateBatchRow(index, { enabled: e.target.checked })} /></td><td className="subtle">{row.nodeId}</td><td><button type="button" className="mini-button danger" onClick={() => void deleteBatchRow(row, index)}>删除</button></td></tr>)}</tbody></table></div></div></section><div className="toast-line">{statusMessage}</div></section>
  )

  const devicesPage = (
    <section className="page-shell">
      <header className="page-header"><div className="page-copy"><h1>设备管理</h1><p>只保留匿名登录，管理 OPC UA 连接参数和在线状态</p></div><div className="page-meta"><span className="status-line">{devices.filter((device) => /connected/i.test(device.status)).length}/{devices.length || 0} 在线</span><button type="button" className="soft-action" onClick={() => void loadWorkspace()} disabled={loading}>{loading ? '刷新中' : '刷新'}</button></div></header>
      <section className="content-strip devices-layout"><div className="device-form-panel"><div className="panel-head"><div><div className="panel-title">{editingDeviceId ? '编辑设备' : '新建设备'}</div><div className="panel-subtitle">匿名登录，保存后可直接连接</div></div><span className="status-line">仅匿名登录</span></div><div className="form-grid"><label><span>设备名称</span><input value={deviceForm.name} onChange={(e) => setDeviceForm((current) => ({ ...current, name: e.target.value }))} placeholder="HCFA-PLC" /></label><label><span>Endpoint URL</span><input value={deviceForm.endpointUrl} onChange={(e) => setDeviceForm((current) => ({ ...current, endpointUrl: e.target.value }))} placeholder="opc.tcp://192.168.88.1:4840" /></label><label><span>安全模式</span><select value={deviceForm.securityMode} onChange={(e) => setDeviceForm((current) => ({ ...current, securityMode: e.target.value }))}><option value="None">None</option><option value="Sign">Sign</option><option value="SignAndEncrypt">SignAndEncrypt</option></select></label><label><span>安全策略</span><select value={deviceForm.securityPolicy} onChange={(e) => setDeviceForm((current) => ({ ...current, securityPolicy: e.target.value }))}><option value="None">None</option><option value="Basic256Sha256">Basic256Sha256</option><option value="Basic128Rsa15">Basic128Rsa15</option></select></label><label className="inline-check"><input type="checkbox" checked={deviceForm.autoConnect} onChange={(e) => setDeviceForm((current) => ({ ...current, autoConnect: e.target.checked }))} /><span>启动时自动连接</span></label><div className="form-note">认证模式已固定为匿名登录，用户名和密码不在界面中展示。</div></div><div className="panel-actions"><button type="button" className="primary-action" onClick={() => void handleSaveDevice()} disabled={savingDeviceId !== null}>{editingDeviceId ? '更新设备' : '创建设备'}</button><button type="button" className="soft-action" onClick={() => { setEditingDeviceId(null); setDeviceForm(blankDeviceForm()) }}>重置</button></div></div><div className="device-list-panel"><div className="panel-head"><div><div className="panel-title">设备列表</div><div className="panel-subtitle">可直接连接、断开、编辑</div></div><span className="status-line">{devices.length} 个设备</span></div><div className="table-shell device-shell"><div className="table-scroll"><table className="list-table"><colgroup><col style={{ width: '170px' }} /><col style={{ width: '100px' }} /><col /><col style={{ width: '86px' }} /><col style={{ width: '120px' }} /></colgroup><thead><tr><th>设备</th><th>状态</th><th>Endpoint</th><th>自动</th><th>操作</th></tr></thead><tbody>{devices.map((device) => <tr key={device.id} className="list-row"><td><strong>{device.name}</strong><div className="node-meta">{device.updatedAt ? new Date(device.updatedAt).toLocaleString('zh-CN') : '-'}</div></td><td><span className={`status-pill ${/connected/i.test(device.status) ? 'normal' : 'fault'}`}>{device.status}</span></td><td className="subtle">{device.endpointUrl}</td><td>{device.autoConnect ? '是' : '否'}</td><td><div className="row-actions"><button type="button" className="mini-button" onClick={() => editDevice(device)}>编辑</button><button type="button" className="mini-button" onClick={() => void connect(device.id)}>连接</button><button type="button" className="mini-button" onClick={() => void disconnect(device.id)}>断开</button></div></td></tr>)}</tbody></table></div></div></div></section><div className="toast-line">{statusMessage}</div></section>
  )

  if (view === 'dashboard') return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-mark">SCADA</div></div><nav className="sidebar-nav" aria-label="主导航">{sidebarItems.map((item) => <button key={item.key} type="button" className={view === item.key ? 'nav-item active' : 'nav-item'} onClick={() => setView(item.key)}><span className="nav-icon">{item.icon}</span><span className="nav-label">{item.label}</span></button>)}</nav></aside><main className="workspace">{dashboardPage}</main></div>
  if (view === 'runtime') return runtimePage
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-mark">SCADA</div></div><nav className="sidebar-nav" aria-label="主导航">{sidebarItems.map((item) => <button key={item.key} type="button" className={view === item.key ? 'nav-item active' : 'nav-item'} onClick={() => setView(item.key)}><span className="nav-icon">{item.icon}</span><span className="nav-label">{item.label}</span></button>)}</nav></aside><main className="workspace">{view === 'tags' ? tagsPage : view === 'batch' ? batchPage : devicesPage}</main></div>
}

export default App
