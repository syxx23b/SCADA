import { useEffect, useMemo, useRef, useState } from 'react'
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr'
import type { FormEvent, ReactNode } from 'react'
import './App.css'
import { browseDevice, createTag, deleteTag, getDevices, getRuntimeOverview, getTags, openVncTool, updateTag, writeTag } from './api'
import type { BrowseNode, DeviceConnection, RuntimeOverview, TagDefinition, TagFormState, TagSnapshot } from './types'

type ViewKey = 'dashboard' | 'runtime' | 'tags' | 'help' | 'login'
type SidebarKey = ViewKey | 'report'
type RuntimeStatus = { label: '正常' | '异常'; className: 'normal' | 'fault' }
type HistoryPoint = { ts: number; value: number }
type DashboardField = { tag?: TagDefinition; snapshot?: TagSnapshot; healthy: boolean; numeric: number | null; text: string; emptyText: string }
type FaceplateTrend = { pressure: HistoryPoint[]; flow: HistoryPoint[] }
type SidebarItem = { key: SidebarKey; label: string; icon: string }

const baseSidebarItems: SidebarItem[] = [
  { key: 'dashboard', label: 'Dashboard', icon: '◉' },
  { key: 'report', label: 'Report', icon: '◌' },
  { key: 'help', label: 'Help', icon: '◇' },
]

const protectedSidebarItems: SidebarItem[] = [
  { key: 'runtime', label: '标签', icon: '▲' },
  { key: 'tags', label: '订阅', icon: '▣' },
]
const dashboardFaceplateIndexes = [1, 2] as const

function getInitialView(): ViewKey {
  const value = new URLSearchParams(window.location.search).get('view')
  if (value === 'batch') return 'tags'
  return value === 'dashboard' || value === 'runtime' || value === 'tags' || value === 'help' || value === 'login' ? value : 'dashboard'
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
  const recipeRule = resolveRecipeRule(tag.nodeId)
  if (recipeRule) return recipeRule.groupKey
  const explicit = tag.groupKey?.trim()
  if (explicit) return explicit
  const match = getDisplayName(tag.nodeId).match(/HMI_DB\.(?:HMI_Faceplates|Faceplates)\[(\d+)\]/i)
  return match ? `${deviceName}_HMI${match[1]}` : '未分组'
}

function isLocalVariableGroup(groupKey: string | null | undefined) {
  return (groupKey ?? '').trim().toLowerCase() === 'local variable'
}

function isLocalVariableTag(tag: TagDefinition) {
  return isLocalVariableGroup(tag.groupKey)
}

function statusOf(tag: TagDefinition, snapshot: TagSnapshot | undefined, deviceStatus: string | undefined): RuntimeStatus {
  if (!snapshot) return { label: '异常', className: 'fault' }

  const q = (snapshot.quality ?? '').toLowerCase()
  const s = (snapshot.connectionState ?? '').toLowerCase()
  const qualityOk = q === '' || q === 'good' || q === '0' || q === '00000000' || q === '0000000'

  if (isLocalVariableTag(tag)) {
    const ok = qualityOk && (s === '' || s === 'connected' || s === 'localstatic')
    return ok ? { label: '正常', className: 'normal' } : { label: '异常', className: 'fault' }
  }

  const device = (deviceStatus ?? '').toLowerCase()
  if (device !== '' && device !== 'connected') return { label: '异常', className: 'fault' }
  const ok = (s === '' || s === 'connected') && qualityOk
  return ok ? { label: '正常', className: 'normal' } : { label: '异常', className: 'fault' }
}

type DeviceConnectionDisplay = {
  label: string
  className: 'normal' | 'warn' | 'fault'
  detail: string
}

function resolveDeviceConnectionDisplay(rawStatus: string | undefined, hasBadSnapshot: boolean, hasSnapshot: boolean): DeviceConnectionDisplay {
  const normalized = (rawStatus ?? '').trim().toLowerCase()

  if (normalized === 'connecting') {
    return { label: 'Connecting', className: 'warn', detail: '设备正在建立连接' }
  }

  if (normalized === 'reconnecting') {
    return { label: 'Reconnecting', className: 'warn', detail: '连接中断后正在自动重连' }
  }

  if (normalized === 'connected') {
    if (hasBadSnapshot) {
      return { label: 'NG', className: 'fault', detail: '连接已建立，但变量质量异常' }
    }

    if (!hasSnapshot) {
      return { label: 'Connected', className: 'warn', detail: '连接已建立，等待首包数据' }
    }

    return { label: 'Connected', className: 'normal', detail: '连接正常' }
  }

  if (normalized === 'faulted') {
    return { label: 'NG', className: 'fault', detail: '连接故障，等待自动重连' }
  }

  if (normalized === 'disconnected') {
    return { label: 'Disconnected', className: 'fault', detail: '连接已断开' }
  }

  return { label: rawStatus || 'Unknown', className: 'fault', detail: '连接状态未知' }
}

function isHealthySnapshot(tag: TagDefinition, snapshot: TagSnapshot | undefined, deviceStatus?: string) {
  return statusOf(tag, snapshot, deviceStatus).className === 'normal'
}

function formatValue(tag: TagDefinition, snapshot: TagSnapshot | undefined, deviceStatus?: string) {
  if (!isHealthySnapshot(tag, snapshot, deviceStatus)) return '-'
  if (snapshot?.value === null || snapshot?.value === undefined || snapshot?.value === '') return '-'
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

function formatCount(value: number | null) {
  if (value === null) return '-'
  return Number.isInteger(value) ? value.toString() : Math.round(value).toString()
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
  const [gradientId] = useState(() => `spark-${Math.random().toString(36).slice(2, 10)}`)
  const normalized = normalizeTrend(points)
  const hasPoints = normalized.length > 0
  const smoothPath = normalized.length <= 1
    ? normalized.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
    : normalized.slice(1).reduce((path, point, index) => {
      const prev = normalized[index]
      const cx = ((prev.x + point.x) / 2).toFixed(2)
      const cy = ((prev.y + point.y) / 2).toFixed(2)
      return `${path} Q ${prev.x.toFixed(2)} ${prev.y.toFixed(2)}, ${cx} ${cy}`
    }, `M ${normalized[0].x.toFixed(2)} ${normalized[0].y.toFixed(2)}`)
  const areaPath = hasPoints ? `${smoothPath} L 98 42 L 2 42 Z` : ''
  return (
    <svg className="dashboard-sparkline" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {areaPath ? <path d={areaPath} fill={`url(#${gradientId})`} /> : null}
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

function resolveRecipeRule(nodeId: string) {
  const displayName = getDisplayName(nodeId).trim()
  const match = displayName.match(/^Recipe_DB\.(?:DJRecipe|QYJRecipe|QYIRecipe)(?:\[(\d+)\]|(\d+))?(?:\.|$)/i)
  if (!match) return null
  const recipeIndex = Number(match[1] ?? match[2] ?? '1') === 2 ? 2 : 1
  return {
    groupKey: `Device1_Recipe${recipeIndex}`,
    intervalMs: 1000,
  }
}

function draftFromBrowse(deviceId: string, deviceName: string, node: BrowseNode): TagFormState {
  const displayName = getDisplayName(node.nodeId)
  const match = displayName.match(/HMI_DB\.(?:HMI_Faceplates|Faceplates)\[(\d+)\]/i)
  const recipeRule = resolveRecipeRule(node.nodeId)
  return {
    deviceId,
    nodeId: node.nodeId,
    browseName: node.browseName || node.displayName,
    displayName,
    dataType: node.dataType ?? 'Unknown',
    samplingIntervalMs: recipeRule?.intervalMs ?? 200,
    publishingIntervalMs: recipeRule?.intervalMs ?? 200,
    allowWrite: node.writable,
    enabled: true,
    groupKey: recipeRule?.groupKey ?? (match ? `${deviceName}_HMI${match[1]}` : '未分组'),
  }
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
  const [statusMessage, setStatusMessage] = useState('系统已就绪')
  const [groupFilter, setGroupFilter] = useState('all')
  const [selectedTagGroupFilter, setSelectedTagGroupFilter] = useState('all')
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [writeDrafts, setWriteDrafts] = useState<Record<string, string>>({})
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [browserSearch, setBrowserSearch] = useState('')
  const [expandedBrowseNodes, setExpandedBrowseNodes] = useState<Record<string, boolean>>({})
  const [browseCache, setBrowseCache] = useState<Record<string, BrowseNode[]>>({})
  const [browseLoadingKeys, setBrowseLoadingKeys] = useState<Record<string, boolean>>({})
  const [selectedBrowseNodes, setSelectedBrowseNodes] = useState<BrowseNode[]>([])
  const [batchDrafts, setBatchDrafts] = useState<TagFormState[]>([])
  const batchSectionRef = useRef<HTMLElement | null>(null)
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
  const rootBrowseLoading = Boolean(browseLoadingKeys[rootBrowseKey])
  const hasLoadedRootBrowse = Object.prototype.hasOwnProperty.call(browseCache, rootBrowseKey)
  const selectedDeviceTags = useMemo(() => tagRows.filter((tag) => tag.deviceId === activeDeviceId), [activeDeviceId, tagRows])
  const selectedDeviceTagGroups = useMemo(() => {
    const unique = new Set<string>(['all'])
    for (const tag of selectedDeviceTags) unique.add(getResolvedGroup(activeDeviceName, tag))
    return Array.from(unique)
  }, [activeDeviceName, selectedDeviceTags])
  const filteredSelectedDeviceTags = useMemo(() => {
    if (selectedTagGroupFilter === 'all') return selectedDeviceTags
    return selectedDeviceTags.filter((tag) => getResolvedGroup(activeDeviceName, tag) === selectedTagGroupFilter)
  }, [activeDeviceName, selectedDeviceTags, selectedTagGroupFilter])
  const batchRows = batchDrafts
  const sidebarItems = useMemo(() => (isAuthenticated ? [...baseSidebarItems, ...protectedSidebarItems] : baseSidebarItems), [isAuthenticated])
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
    const deviceStatus = tag ? runtimeDeviceStatusById[tag.deviceId] : undefined
    const healthy = tag ? isHealthySnapshot(tag, snapshot, deviceStatus) : false
    const numeric = healthy ? toNumericValue(snapshot?.value ?? null) : null
    const emptyText = formatNumberWithUnit(null, inferUnit(name), digitsMap[key])
    return {
      tag,
      snapshot,
      healthy,
      numeric,
      text: healthy ? formatNumberWithUnit(numeric, inferUnit(name), digitsMap[key]) : emptyText,
      emptyText,
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
    const triggerCount = dashboardField(faceplateIndex, 'triggercount', /triggercount|trigger_count/)
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
    const hasConnectedDevice = faceplateTags.some((tag) => (runtimeDeviceStatusById[tag.deviceId] ?? '').toLowerCase() === 'connected')
    const hasGoodSnapshot = faceplateTags.some((tag) => {
      const snapshot = snapshotByTagId.get(tag.id)
      if (!snapshot) return false
      const q = (snapshot.quality ?? '').toLowerCase()
      const s = (snapshot.connectionState ?? '').toLowerCase()
      const qualityOk = q === '' || q === 'good' || q === '0' || q === '00000000' || q === '0000000'
      const stateOk = s === '' || s === 'connected'
      return qualityOk && stateOk
    })
    const faceplateDeviceStatuses = Array.from(
      new Set(faceplateTags.map((tag) => (runtimeDeviceStatusById[tag.deviceId] ?? '').toLowerCase()).filter((value) => value !== '')),
    )
    const hasDeviceDisconnecting = faceplateDeviceStatuses.some((status) =>
      status.includes('reconnect') || status.includes('disconnect') || status.includes('offline') || status.includes('fault') || status.includes('error'),
    )
    const connected = hasConnectedDevice && !hasDeviceDisconnecting && hasGoodSnapshot
    const boardHeadClass =
      !connected
        ? 'disconnected'
        : (errCode.numeric ?? 0) > 0
          ? 'fault'
          : (workFlow.numeric ?? 0) > 0
            ? 'connected'
            : 'standby'
    const noDataText = '-'
    const maskField = (field: DashboardField): DashboardField =>
      connected ? field : { ...field, healthy: false, numeric: null, text: field.emptyText }
    const safeStatus = connected ? status : { text: noDataText, className: 'fault' as const }

    return {
      faceplateIndex,
      available: (dashboardTagsByFaceplate[faceplateIndex] ?? []).length > 0,
      title: stationNumber.numeric !== null ? `工位${stationNumber.numeric}` : `工位${faceplateIndex}`,
      stationText:
        connected
          ? (
              barcode.snapshot?.value === null || barcode.snapshot?.value === undefined
                ? '-'
                : String(barcode.snapshot.value).trim() || '-'
            )
          : noDataText,
      deviceStatus: connected ? `Connected / ${status.text}` : 'Disconnected',
      boardHeadClass,
      risk: { label: safeStatus.className === 'normal' ? '正常' : '异常', className: safeStatus.className },
      statusText: safeStatus.text,
      workflowText: connected ? workflowText : noDataText,
      workflowClass,
      pressure: maskField(pressure),
      flow: maskField(flow),
      inletPressure: maskField(inletPressure),
      inletTemp: maskField(inletTemp),
      voltage: maskField(voltage),
      current: maskField(current),
      frequency: maskField(frequency),
      power: maskField(power),
      passNumber: maskField(passNumber),
      failNumber: maskField(failNumber),
      errCode: maskField(errCode),
      enduranceProcess: maskField(enduranceProcess),
      triggerOn: maskField(triggerOn),
      triggerOff: maskField(triggerOff),
      triggerCount: maskField(triggerCount),
      pressureSeries: connected ? pressureSeries : [],
      flowSeries: connected ? flowSeries : [],
      endurancePercent: connected ? endurancePercent : 0,
      passPercent: connected ? passPercent : 0,
      failPercent: connected ? failPercent : 0,
      showEnduranceCard: connected ? showEnduranceCard : false,
      enduranceDuration: connected ? enduranceDuration : noDataText,
      triggerOnPercent: connected ? triggerOnPercent : 0,
      triggerOffPercent: connected ? triggerOffPercent : 0,
      passCountText: connected ? formatCount(passNumber.numeric) : noDataText,
      failCountText: connected ? formatCount(failNumber.numeric) : noDataText,
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
      const deviceStatus = runtimeDeviceStatusById[tag.deviceId]
      const stat = statusOf(tag, snapshot, deviceStatus)
      const group = getResolvedGroup(runtimeNameById[tag.deviceId] ?? '', tag)
      const healthyValue = formatValue(tag, snapshot, deviceStatus)
      return {
        risk: index + 1,
        tag,
        snapshot,
        stat,
        group,
        healthyValue,
        time: compactTimeText(snapshot),
      }
    })
  }, [filteredRuntimeTags, runtimeDeviceStatusById, runtimeNameById, snapshotByTagId])

  const deviceStatusCards = useMemo(() => {
    return runtime.devices.map((runtimeDevice) => {
      const device = devices.find((d) => d.id === runtimeDevice.deviceId)
      const runtimeStatus = runtimeDevice.status
      const deviceTags = runtime.tags.filter((tag) => tag.deviceId === runtimeDevice.deviceId)
      let hasSnapshot = false
      let hasBadSnapshot = false

      for (const tag of deviceTags) {
        if (isLocalVariableTag(tag)) continue

        const snapshot = snapshotByTagId.get(tag.id)
        if (!snapshot) continue
        hasSnapshot = true
        if (statusOf(tag, snapshot, runtimeStatus).className !== 'normal') {
          hasBadSnapshot = true
          break
        }
      }

      const display = resolveDeviceConnectionDisplay(runtimeStatus, hasBadSnapshot, hasSnapshot)
      return {
        id: runtimeDevice.deviceId,
        name: runtimeDevice.deviceName,
        endpointUrl: device?.endpointUrl ?? runtimeDevice.endpointUrl,
        autoConnect: device?.autoConnect ?? false,
        updatedAt: device?.updatedAt,
        statusLabel: display.label,
        statusClassName: display.className,
        statusDetail: display.detail,
      }
    })
  }, [devices, runtime.devices, runtime.tags, runtimeDeviceStatusById, snapshotByTagId])

  const onlineDeviceCount = useMemo(
    () => deviceStatusCards.filter((item) => item.statusClassName === 'normal').length,
    [deviceStatusCards],
  )

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

  async function loadBrowse(deviceId: string, nodeId: string | null, force = false) {
    if (!deviceId) return
    const key = `${deviceId}|${nodeId ?? '__root__'}`
    if (!force && (browseLoadingKeys[key] || Object.prototype.hasOwnProperty.call(browseCache, key))) return

    try {
      setBrowseLoadingKeys((current) => ({ ...current, [key]: true }))
      const nodes = await browseDevice(deviceId, nodeId ?? undefined)
      setBrowseCache((current) => ({ ...current, [key]: nodes }))
    } catch (error) {
      setBrowseCache((current) => {
        if (!Object.prototype.hasOwnProperty.call(current, key)) return current
        const next = { ...current }
        delete next[key]
        return next
      })
      setStatusMessage(error instanceof Error ? error.message : '浏览目录失败')
    } finally {
      setBrowseLoadingKeys((current) => {
        if (!current[key]) return current
        const next = { ...current }
        delete next[key]
        return next
      })
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
  useEffect(() => { setSelectedTagGroupFilter('all') }, [activeDeviceId])
  useEffect(() => {
    if (!isAuthenticated && (view === 'runtime' || view === 'tags')) {
      setView('login')
      setStatusMessage('请先登录后再访问标签与订阅')
    }
  }, [isAuthenticated, view])
  useEffect(() => {
    if (!activeDeviceId) return
    setExpandedBrowseNodes({})
    setSelectedBrowseNodes([])
    void loadBrowse(activeDeviceId, null)
  }, [activeDeviceId])

  function focusBatchSection() {
    setView('tags')
    window.requestAnimationFrame(() => {
      batchSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

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

  function toggleFolder(node: BrowseNode) {
    setExpandedBrowseNodes((current) => {
      const nextExpanded = !current[node.nodeId]
      if (nextExpanded) void loadBrowse(activeDeviceId, node.nodeId)
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
    focusBatchSection()
  }

  function loadDeviceTagsToBatch() {
    setBatchDrafts(selectedDeviceTags.map((tag) => draftFromTag(tag, activeDeviceName)))
    setStatusMessage(`已载入 ${selectedDeviceTags.length} 个已订阅变量`)
    focusBatchSection()
  }
  function clearBatchDrafts() { setBatchDrafts([]); setStatusMessage('已清空批量配置列表') }
  function applyBatchDefaults() {
    setBatchDrafts((current) => current.map((row) => {
      const groupKey = row.groupKey?.trim() || '未分组'
      const isLocal = isLocalVariableGroup(groupKey)
      const recipeRule = resolveRecipeRule(row.nodeId)
      return {
        ...row,
        displayName: row.displayName.trim() || getDisplayName(row.nodeId) || 'Local Variable',
        groupKey: isLocal ? 'Local Variable' : (recipeRule?.groupKey || groupKey),
        nodeId: isLocal ? (row.nodeId.startsWith('local://') ? row.nodeId : '') : row.nodeId,
        samplingIntervalMs: isLocal ? 0 : (recipeRule?.intervalMs || row.samplingIntervalMs || 200),
        publishingIntervalMs: isLocal ? 0 : (recipeRule?.intervalMs || row.publishingIntervalMs || 200),
        enabled: true,
      }
    }))
    setStatusMessage('默认规则已应用')
  }
  function updateBatchRow(index: number, patch: Partial<TagFormState>) { setBatchDrafts((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row))) }

  async function saveBatch() {
    if (batchRows.length === 0) return setStatusMessage('没有可保存的变量')
    try {
      setSavingBatch(true)
      for (const row of batchRows) {
        const groupKey = row.groupKey?.trim() || '未分组'
        const isLocal = isLocalVariableGroup(groupKey)
        const recipeRule = resolveRecipeRule(row.nodeId)
        const payload: TagFormState = {
          ...row,
          nodeId: isLocal ? (row.nodeId.startsWith('local://') ? row.nodeId : '') : row.nodeId,
          displayName: row.displayName.trim() || getDisplayName(row.nodeId) || 'Local Variable',
          groupKey: isLocal ? 'Local Variable' : (recipeRule?.groupKey || groupKey),
          samplingIntervalMs: isLocal ? 0 : (recipeRule?.intervalMs || Number(row.samplingIntervalMs) || 200),
          publishingIntervalMs: isLocal ? 0 : (recipeRule?.intervalMs || Number(row.publishingIntervalMs) || 200),
          allowWrite: Boolean(row.allowWrite),
          enabled: Boolean(row.enabled),
        }
        if (row.id) await updateTag(row.id, payload); else await createTag(payload)
      }
      await loadWorkspace(); await refreshRuntime(); setBatchDrafts([]); setSelectedBrowseNodes([]); setStatusMessage('批量保存成功，列表已清空')
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

  function editRuntimeTag(tag: TagDefinition) {
    const deviceName = runtimeNameById[tag.deviceId] || activeDeviceName
    setSelectedDeviceId(tag.deviceId)
    setBatchDrafts([draftFromTag(tag, deviceName)])
    focusBatchSection()
  }
  async function removeRuntimeTag(id: string) { try { await deleteTag(id); await loadWorkspace(); await refreshRuntime(); setStatusMessage('订阅变量已删除') } catch (error) { setStatusMessage(error instanceof Error ? error.message : '删除失败') } }

  function handleSidebarClick(key: SidebarKey) {
    if (key === 'report') {
      const popup = window.open('http://localhost:8080/webroot/decision', '_blank', 'noopener,noreferrer')
      if (!popup) setStatusMessage('Report 页面被浏览器拦截，请允许弹窗后重试')
      return
    }

    if (!isAuthenticated && (key === 'runtime' || key === 'tags')) {
      setView('login')
      setStatusMessage('请先登录后再访问标签与订阅')
      return
    }

    setView(key)
  }

  function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loginUsername === 'ZXC' && loginPassword === '1826') {
      setIsAuthenticated(true)
      setLoginPassword('')
      setView('runtime')
      setStatusMessage('登录成功，已开放标签与订阅菜单')
      return
    }

    setStatusMessage('登录失败：用户名或密码错误')
  }

  function handleLogout() {
    setIsAuthenticated(false)
    setLoginUsername('')
    setLoginPassword('')
    setView('login')
    setStatusMessage('已退出登录')
  }

  function handleAuthEntryClick() {
    if (isAuthenticated) {
      handleLogout()
      return
    }

    setView('login')
    setStatusMessage('请先登录')
  }

  function renderSidebarButtons(mode: 'default' | 'runtime') {
    const isRuntime = mode === 'runtime'
    const hasRuntimeEntry = sidebarItems.some((item) => item.key === 'runtime')

    const rendered = sidebarItems.flatMap((item) => {
      const itemClass = isRuntime ? (view === item.key ? 'runtime-nav active' : 'runtime-nav') : (view === item.key ? 'nav-item active' : 'nav-item')
      const iconClass = isRuntime ? 'runtime-nav-icon' : 'nav-icon'
      const labelClass = isRuntime ? 'runtime-nav-label' : 'nav-label'

      if (item.key === 'runtime') {
        return [
          <div key={`sidebar-auth-before-${mode}`}>
            <div className="sidebar-divider" aria-hidden="true" />
            <div className="sidebar-auth-inline">
              <button type="button" className="sidebar-auth-entry" onClick={handleAuthEntryClick}>
                <span className="sidebar-auth-icon">↪</span>
                <span className="sidebar-auth-label">{isAuthenticated ? 'Logout' : 'Login'}</span>
              </button>
            </div>
            <button type="button" className={itemClass} onClick={() => handleSidebarClick(item.key)}>
              <span className={iconClass}>{item.icon}</span>
              <span className={labelClass}>{item.label}</span>
            </button>
          </div>,
        ]
      }

      return [
        <button key={item.key} type="button" className={itemClass} onClick={() => handleSidebarClick(item.key)}>
          <span className={iconClass}>{item.icon}</span>
          <span className={labelClass}>{item.label}</span>
        </button>,
      ]
    })

    if (!hasRuntimeEntry) {
      rendered.push(
        <div key={`sidebar-auth-tail-${mode}`} className="sidebar-auth-inline">
          <button type="button" className="sidebar-auth-entry" onClick={handleAuthEntryClick}>
            <span className="sidebar-auth-icon">↪</span>
            <span className="sidebar-auth-label">Login</span>
          </button>
        </div>,
      )
    }

    return rendered
  }

  const runtimePage = (
    <section className="runtime-shell">
      <aside className="runtime-sidebar">
        <div className="runtime-brand">
          <div className="runtime-brand-mark">清洗机测试系统</div>
        </div>
        <nav className="runtime-sidebar-nav" aria-label="主导航">
          {renderSidebarButtons('runtime')}
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

        <section className="runtime-device-status-strip" aria-label="设备连接状态总览">
          <article className="runtime-device-status-card">
            <header className="runtime-device-status-head">
              <strong>设备连接状态</strong>
              <span className="status-line">{onlineDeviceCount}/{deviceStatusCards.length || 0} 正常连接 · 自动更新</span>
            </header>
            {deviceStatusCards.length === 0 ? (
              <div className="empty-note">暂无设备状态数据</div>
            ) : (
              <div className="runtime-device-status-list">
                {deviceStatusCards.map((device) => (
                  <div key={device.id} className={`runtime-device-status-item ${device.statusClassName}`}>
                    <div className="runtime-device-status-main">
                      <span className="runtime-device-name">{device.name}</span>
                      <span className="node-meta">{device.endpointUrl}</span>
                    </div>
                    <span className={`status-pill ${device.statusClassName}`}>{device.statusLabel}</span>
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>

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
                <col style={{ width: '96px' }} />
                <col style={{ width: '96px' }} />
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
                  <th>订阅周期</th>
                  <th>发布周期</th>
                </tr>
              </thead>
              <tbody>
                {runtimeRows.map(({ risk, tag, stat, group, healthyValue, time }) => {
                  const displayValue = stat.className === 'normal' ? healthyValue : '暂无数据'
                  return (
                    <tr key={tag.id}>
                      <td className="row-index">{risk}</td>
                      <td>
                        <div className="project-name">{tag.displayName}</div>
                      </td>
                      <td>
                        <div className="project-value">{displayValue}</div>
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
                      <td className="subtle">{isLocalVariableTag(tag) ? '-' : (tag.nodeId || '-')}</td>
                      <td>
                        {tag.allowWrite ? (
                          <div className="write-cell">
                            <input
                              value={writeDrafts[tag.id] ?? ''}
                              onChange={(e) => setWriteDrafts((current) => ({ ...current, [tag.id]: e.target.value }))}
                              placeholder={displayValue}
                            />
                            <button type="button" className="write-mini" onClick={() => void handleWrite(tag.id)} disabled={savingTagId === tag.id}>
                              {savingTagId === tag.id ? '...' : '写入'}
                            </button>
                          </div>
                        ) : (
                          <span className="subtle">只读</span>
                        )}
                      </td>
                      <td>{Math.round(tag.samplingIntervalMs)} ms</td>
                      <td>{Math.round(tag.publishingIntervalMs)} ms</td>
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
                        <div className="dashboard-bar-row count-only">
                          <div className="dashboard-bar-label">次数</div>
                          <strong>{formatCount(dashboardData.triggerCount.numeric)}</strong>
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
                          <div className="dashboard-bar-label">合格</div>
                          <div className="dashboard-bar-track">
                            <div className="dashboard-bar-fill positive" style={{ width: `${dashboardData.passPercent}%` }} />
                          </div>
                          <strong>{dashboardData.passCountText}</strong>
                        </div>
                        <div className="dashboard-bar-row">
                          <div className="dashboard-bar-label">失败</div>
                          <div className="dashboard-bar-track">
                            <div className="dashboard-bar-fill negative" style={{ width: `${dashboardData.failPercent}%` }} />
                          </div>
                          <strong>{dashboardData.failCountText}</strong>
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
        <button type="button" className="soft-action" onClick={() => void loadBrowse(activeDeviceId, null, true)}>
          刷新目录
        </button>
        <button type="button" className="soft-action" onClick={() => setSelectedBrowseNodes([])}>
          清空勾选
        </button>
      </section>

      <section className="content-strip tags-layout">
        <div className="browser-panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">目录树</div>
              <div className="panel-subtitle">目录节点展开显示，叶子节点才允许勾选</div>
            </div>
            <div className="panel-actions panel-actions-in-head">
              <span className="status-line">{rootBrowseLoading ? '目录加载中…' : '当前只看这个目录下的内容'}</span>
              <button type="button" className="primary-action" onClick={addSelectionToBatch}>
                加入批量配置
              </button>
            </div>
          </div>
          <div className="tree-shell">
            {!activeDeviceId ? (
              <div className="empty-note">请先选择设备</div>
            ) : rootBrowseLoading && rootBrowseNodes.length === 0 ? (
              <div className="empty-note">目录加载中…</div>
            ) : hasLoadedRootBrowse && rootBrowseNodes.length === 0 ? (
              <div className="empty-note">暂无目录数据</div>
            ) : (
              renderBrowseTree(null)
            )}
          </div>
        </div>

        <div className="detail-column">
          <section className="detail-panel detail-panel-batch" ref={batchSectionRef}>
            <div className="panel-head panel-head-stack">
              <div>
                <div className="panel-title">批量配置</div>
                <div className="panel-subtitle">统一修改显示名称、分组和订阅参数，保存后立即刷新订阅</div>
              </div>
              <div className="batch-inline-actions">
                <span className="status-line">{activeDeviceName} · {batchRows.length} 条待配置</span>
                <button type="button" className="soft-action" onClick={loadDeviceTagsToBatch}>
                  载入当前设备变量
                </button>
                <button type="button" className="soft-action" onClick={applyBatchDefaults} disabled={batchRows.length === 0}>
                  应用默认规则
                </button>
                <button type="button" className="soft-action" onClick={clearBatchDrafts} disabled={batchRows.length === 0}>
                  清空列表
                </button>
                <button type="button" className="primary-action" onClick={() => void saveBatch()} disabled={savingBatch || batchRows.length === 0}>
                  {savingBatch ? '保存中' : '保存全部'}
                </button>
              </div>
            </div>
            <div className="table-shell batch-shell batch-inline-shell">
              <div className="table-scroll">
                {batchRows.length === 0 ? (
                  <div className="empty-note batch-empty-note">先从目录树勾选变量，或载入当前设备已订阅变量。</div>
                ) : (
                  <table className="runtime-table batch-table">
                    <colgroup>
                      <col style={{ width: '320px' }} />
                      <col style={{ width: '150px' }} />
                      <col style={{ width: '76px' }} />
                      <col style={{ width: '76px' }} />
                      <col style={{ width: '64px' }} />
                      <col style={{ width: '64px' }} />
                      <col />
                      <col style={{ width: '70px' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>显示名称</th>
                        <th>分组</th>
                        <th>采样</th>
                        <th>发布</th>
                        <th>写入</th>
                        <th>启用</th>
                        <th>NodeId</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchRows.map((row, index) => (
                        <tr key={row.id ?? `${row.nodeId}-${index}`}>
                          <td><input value={row.displayName} onChange={(e) => updateBatchRow(index, { displayName: e.target.value })} placeholder="显示名称" /></td>
                          <td><input value={row.groupKey} onChange={(e) => updateBatchRow(index, { groupKey: e.target.value })} placeholder="分组" /></td>
                          <td><input type="number" value={row.samplingIntervalMs} onChange={(e) => updateBatchRow(index, { samplingIntervalMs: Number(e.target.value) || 200 })} /></td>
                          <td><input type="number" value={row.publishingIntervalMs} onChange={(e) => updateBatchRow(index, { publishingIntervalMs: Number(e.target.value) || 200 })} /></td>
                          <td><input type="checkbox" checked={row.allowWrite} onChange={(e) => updateBatchRow(index, { allowWrite: e.target.checked })} /></td>
                          <td><input type="checkbox" checked={row.enabled} onChange={(e) => updateBatchRow(index, { enabled: e.target.checked })} /></td>
                          <td className="subtle">{isLocalVariableGroup(row.groupKey) ? '-' : (row.nodeId || '-')}</td>
                          <td><button type="button" className="mini-button danger" onClick={() => void deleteBatchRow(row, index)}>删除</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </section>

          <section className="detail-panel">
            <div className="panel-head">
              <div>
                <div className="panel-title">已订阅变量</div>
                <div className="panel-subtitle">当前设备下的已配置点位</div>
              </div>
              <div className="panel-actions panel-actions-in-head">
                <span className="status-line">{filteredSelectedDeviceTags.length}/{selectedDeviceTags.length} 个</span>
                <select className="header-filter" value={selectedTagGroupFilter} onChange={(e) => setSelectedTagGroupFilter(e.target.value)} aria-label="按分组筛选已订阅变量">
                  <option value="all">全部分组</option>
                  {selectedDeviceTagGroups.filter((g) => g !== 'all').map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
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
                    {filteredSelectedDeviceTags.map((tag) => (
                      <tr key={tag.id} className="list-row">
                        <td>
                          <strong>{tag.displayName}</strong>
                          <div className="node-meta">{isLocalVariableTag(tag) ? '-' : (tag.nodeId || '-')}</div>
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

  const helpPage = (
    <section className="page-shell">
      <header className="page-header">
        <div className="page-copy">
          <h1>帮助文档</h1>
          <p>系统内置 PDF 阅读器</p>
        </div>
      </header>

      <section className="content-strip help-layout">
        <div className="help-pdf-shell">
          <iframe className="help-pdf-frame" src="/help/manual#zoom=100" title="系统操作手册 PDF" />
        </div>
      </section>

      <div className="toast-line">{statusMessage}</div>
    </section>
  )

  const loginPage = (
    <section className="page-shell">
      <header className="page-header">
        <div className="page-copy">
          <h1>用户登录</h1>
          <p>登录后才显示“标签”和“订阅”菜单</p>
        </div>
      </header>

      <section className="content-strip login-layout">
        <div className="login-card">
          <div className="login-head">
            <h2>欢迎登录</h2>
          </div>

          {isAuthenticated ? (
            <div className="login-success">
              <strong>当前已登录用户：ZXC</strong>
              <p>你现在可以使用“标签”和“订阅”两项功能。</p>
              <button type="button" className="login-submit" onClick={handleLogout}>退出登录</button>
            </div>
          ) : (
            <form className="login-form" onSubmit={handleLoginSubmit}>
              <label>
                <span>用户名</span>
                <input className="login-input" value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} placeholder="请输入用户名" autoComplete="username" />
              </label>
              <label>
                <span>密码</span>
                <input className="login-input" type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="请输入密码" autoComplete="current-password" />
              </label>
              <button type="submit" className="login-submit">登录</button>
            </form>
          )}
        </div>
      </section>

      <div className="toast-line">{statusMessage}</div>
    </section>
  )

  const sidebarShell = (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">清洗机测试系统</div>
      </div>
      <nav className="sidebar-nav" aria-label="主导航">
        {renderSidebarButtons('default')}
      </nav>

    </aside>
  )

  if (view === 'dashboard') return <div className="app-shell">{sidebarShell}<main className="workspace">{dashboardPage}</main></div>
  if (view === 'runtime') return isAuthenticated ? runtimePage : <div className="app-shell">{sidebarShell}<main className="workspace">{loginPage}</main></div>
  return <div className="app-shell">{sidebarShell}<main className="workspace">{view === 'tags' ? (isAuthenticated ? tagsPage : loginPage) : view === 'help' ? helpPage : loginPage}</main></div>
}

export default App
