import { useEffect, useMemo, useState } from 'react'
import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr'
import type { ReactNode } from 'react'
import './App.css'
import { browseDevice, connectDevice, createDevice, createTag, deleteTag, disconnectDevice, getDevices, getRuntimeOverview, getTags, updateDevice, updateTag, writeTag } from './api'
import type { BrowseNode, DeviceConnection, DeviceFormState, RuntimeOverview, TagDefinition, TagFormState, TagSnapshot } from './types'

type ViewKey = 'dashboard' | 'runtime' | 'tags' | 'batch' | 'devices'
type RuntimeStatus = { label: '正常' | '异常'; className: 'normal' | 'fault' }
type HistoryPoint = { ts: number; value: number }
type DashboardMetric = { tag: TagDefinition; label: string; value: string }
type DashboardGroup = {
  name: string
  tags: TagDefinition[]
  pressure?: TagDefinition
  flow?: TagDefinition
  metrics: DashboardMetric[]
  pressureSeries: HistoryPoint[]
  flowSeries: HistoryPoint[]
}

const sidebarItems: Array<{ key: ViewKey; label: string; icon: string }> = [
  { key: 'dashboard', label: 'Dashboard', icon: '◉' },
  { key: 'runtime', label: '监控', icon: '▲' },
  { key: 'tags', label: '订阅', icon: '▣' },
  { key: 'batch', label: '批量', icon: '⌘' },
  { key: 'devices', label: '设备', icon: '◫' },
]

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
  const match = getDisplayName(tag.nodeId).match(/HMI_DB\.HMI_Faceplates\[(\d+)\]/i)
  return match ? `${deviceName}_HMI${match[1]}` : '未分组'
}

const DASHBOARD_HISTORY_WINDOW_MS = 2 * 60 * 1000

function statusOf(snapshot: TagSnapshot | undefined): RuntimeStatus {
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

function timeText(snapshot: TagSnapshot | undefined) {
  return snapshot?.sourceTimestamp ? new Date(snapshot.sourceTimestamp).toLocaleString('zh-CN') : '-'
}

function shortLabel(tag: TagDefinition) {
  return getDisplayName(tag.nodeId).split('.').pop() || tag.displayName
}

function pickExactTag(tags: TagDefinition[], preferredName: string, fallbackPattern: RegExp) {
  return (
    tags.find((tag) => shortLabel(tag).toLowerCase() === preferredName.toLowerCase()) ??
    tags.find((tag) => fallbackPattern.test(shortLabel(tag)))
  )
}

function inferUnit(label: string) {
  const value = label.toLowerCase()
  if (/pressure|press/.test(value)) return 'bar'
  if (/flow/.test(value)) return 'm³/h'
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
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const cleaned = value.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
    const parsed = cleaned ? Number(cleaned[0]) : Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function formatNumberWithUnit(value: number | null, unit: string) {
  if (value === null) return `- ${unit}`.trim()
  const rounded = Number.isInteger(value) ? value.toString() : value.toFixed(2)
  return unit ? `${rounded} ${unit}` : rounded
}

function pickDashboardGroups(tags: TagDefinition[], runtimeNameLookup: Record<string, string>) {
  const byName = new Map<string, TagDefinition[]>()
  for (const tag of tags) {
    const groupName = getResolvedGroup(runtimeNameLookup[tag.deviceId] ?? '', tag)
    if (!byName.has(groupName)) byName.set(groupName, [])
    byName.get(groupName)?.push(tag)
  }
  const names = Array.from(byName.keys())
  const preferred = [
    names.find((name) => /HMI1/i.test(name)),
    names.find((name) => /HMI2/i.test(name)),
    ...names.filter((name) => !/HMI1|HMI2/i.test(name)),
  ].filter((name, index, array) => Boolean(name) && array.indexOf(name) === index) as string[]
  return preferred.slice(0, 2).map((name) => ({ name, tags: byName.get(name) ?? [] }))
}

function updateHistoryMap(current: Record<string, HistoryPoint[]>, snapshot: TagSnapshot) {
  const numeric = toNumericValue(snapshot.value)
  if (numeric === null) return current
  const tsText = snapshot.sourceTimestamp ?? snapshot.serverTimestamp ?? new Date().toISOString()
  const ts = Number.isNaN(Date.parse(tsText)) ? Date.now() : Date.parse(tsText)
  const existing = (current[snapshot.tagId] ?? []).filter((point) => ts - point.ts <= DASHBOARD_HISTORY_WINDOW_MS)
  const last = existing[existing.length - 1]
  if (last && last.ts === ts && last.value === numeric) return current
  const next = [...existing, { ts, value: numeric }].filter((point) => ts - point.ts <= DASHBOARD_HISTORY_WINDOW_MS)
  return { ...current, [snapshot.tagId]: next }
}

function normalizeTrend(points: HistoryPoint[]) {
  if (points.length === 0) return []
  const usePoints = points.length === 1 ? [{ ts: points[0].ts - 60_000, value: points[0].value }, points[0]] : points
  const values = usePoints.map((point) => point.value)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || Math.max(Math.abs(max), 1)
  return usePoints.map((point, index) => {
    const x = usePoints.length === 1 ? 100 : (index / (usePoints.length - 1)) * 100
    const y = 36 - ((point.value - min) / range) * 28
    return { x, y, value: point.value }
  })
}

function getSeriesPoints(tag: TagDefinition | undefined, historyByTag: Record<string, HistoryPoint[]>, snapshotByTagId: Map<string, TagSnapshot>) {
  if (!tag) return []
  const history = historyByTag[tag.id] ?? []
  if (history.length > 0) return history.slice(-12)
  const snapshot = snapshotByTagId.get(tag.id)
  const numeric = toNumericValue(snapshot?.value ?? null)
  if (numeric === null) return []
  const tsText = snapshot?.sourceTimestamp ?? snapshot?.serverTimestamp ?? new Date().toISOString()
  const ts = Number.isNaN(Date.parse(tsText)) ? Date.now() : Date.parse(tsText)
  return [{ ts, value: numeric }]
}

function TrendChart({
  series,
}: {
  series: Array<{ label: string; unit: string; color: string; points: HistoryPoint[]; current: string }>
}) {
  return (
    <div className="trend-chart">
      <svg viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true">
        <g className="trend-grid">
          <line x1="0" y1="8" x2="100" y2="8" />
          <line x1="0" y1="20" x2="100" y2="20" />
          <line x1="0" y1="32" x2="100" y2="32" />
        </g>
        {series.map((item) => {
          const points = normalizeTrend(item.points)
          if (points.length === 0) return null
          const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
          const last = points[points.length - 1]
          return (
            <g key={item.label}>
              <path d={path} fill="none" stroke={item.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={last.x} cy={last.y} r="1.8" fill={item.color} />
            </g>
          )
        })}
      </svg>
      <div className="trend-legend">
        {series.map((item) => (
          <div key={item.label} className="trend-legend-item">
            <span className="legend-dot" style={{ background: item.color }} />
            <div>
              <strong>{item.label}</strong>
              <span>{item.current}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function draftFromBrowse(deviceId: string, deviceName: string, node: BrowseNode): TagFormState {
  const displayName = getDisplayName(node.nodeId)
  const match = displayName.match(/HMI_DB\.HMI_Faceplates\[(\d+)\]/i)
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
  const [historyByTag, setHistoryByTag] = useState<Record<string, HistoryPoint[]>>({})

  const runtimeNameById = useMemo(() => Object.fromEntries(runtime.devices.map((d) => [d.deviceId, d.deviceName])), [runtime.devices])
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

  const dashboardGroups = useMemo(() => {
    const selected = pickDashboardGroups(runtime.tags, runtimeNameById)
    return selected.map<DashboardGroup>((group) => {
      const numericTags = group.tags.filter((tag) => toNumericValue(snapshotByTagId.get(tag.id)?.value ?? null) !== null)
      const pressure = pickExactTag(group.tags, 'pressure', /pressure|press|inletpress|outletpress/i) ?? numericTags[0]
      const flow = pickExactTag(group.tags, 'flow', /flow/i) ?? numericTags.find((tag) => tag.id !== pressure?.id)
      const pressureSeries = getSeriesPoints(pressure, historyByTag, snapshotByTagId)
      const flowSeries = getSeriesPoints(flow, historyByTag, snapshotByTagId)
      const metrics = numericTags
        .filter((tag) => tag.id !== pressure?.id && tag.id !== flow?.id)
        .map((tag) => {
          const snapshot = snapshotByTagId.get(tag.id)
          const numeric = toNumericValue(snapshot?.value ?? null)
          if (numeric === null) return null
          return {
            tag,
            label: shortLabel(tag),
            value: formatNumberWithUnit(numeric, inferUnit(shortLabel(tag) || tag.displayName)),
          }
        })
        .filter((item): item is DashboardMetric => Boolean(item))
        .slice(0, 6)
      return {
        name: group.name,
        tags: group.tags,
        pressure,
        flow,
        pressureSeries,
        flowSeries,
        metrics,
      }
    })
  }, [historyByTag, runtime.tags, runtimeNameById, snapshotByTagId])

  const filteredRuntimeTags = useMemo(() => {
    return runtime.tags.filter((tag) => {
      const group = getResolvedGroup(runtimeNameById[tag.deviceId] ?? '', tag)
      return groupFilter === 'all' || group === groupFilter
    })
  }, [groupFilter, runtime.tags, runtimeNameById])

  async function loadWorkspace() {
    try {
      setLoading(true)
      const [overview, deviceList, tags] = await Promise.all([getRuntimeOverview(), getDevices(), getTags()])
      setRuntime(overview)
      setHistoryByTag((current) => {
        let next = current
        for (const snapshot of overview.snapshots) next = updateHistoryMap(next, snapshot)
        return next
      })
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
      setHistoryByTag((current) => {
        let next = current
        for (const snapshot of overview.snapshots) next = updateHistoryMap(next, snapshot)
        return next
      })
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
      setHistoryByTag((current) => updateHistoryMap(current, snapshot))
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
            <h1>实时监控</h1>
          </div>
          <div className="runtime-topbar-actions">
            <button type="button" className="icon-circle">◔</button>
            <button type="button" className="icon-circle">?</button>
            <div className="avatar-circle">SC</div>
          </div>
        </header>

        <section className="runtime-toolbar-row">
          <div className="runtime-selected">分组筛选</div>
          <div className="runtime-actions-group">
            <select className="runtime-filter" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
              <option value="all">全部分组</option>
              {groups.filter((g) => g !== 'all').map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <button type="button" className="primary-project-button" onClick={() => void refreshRuntime()} disabled={loading}>
            + {loading ? '刷新中' : '刷新'}
          </button>
        </section>

        <section className="runtime-table-wrap">
          <div className="runtime-table-shell">
            <table className="runtime-table project-table">
              <colgroup>
                <col style={{ width: '280px' }} />
                <col style={{ width: '140px' }} />
                <col style={{ width: '120px' }} />
                <col style={{ width: '220px' }} />
                <col style={{ width: '110px' }} />
                <col style={{ width: '240px' }} />
                <col style={{ width: '150px' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>变量名称</th>
                  <th>当前值</th>
                  <th>状态</th>
                  <th>最新时间</th>
                  <th>分组</th>
                  <th>NodeId</th>
                  <th>写入</th>
                </tr>
              </thead>
              <tbody>
                {filteredRuntimeTags.map((tag) => {
                  const snapshot = runtime.snapshots.find((item) => item.tagId === tag.id)
                  const stat = statusOf(snapshot)
                  const group = getResolvedGroup(runtimeNameById[tag.deviceId] ?? '', tag)
                  const value = formatValue(tag, snapshot)
                  return (
                    <tr key={tag.id}>
                      <td>
                        <div className="project-name">{tag.displayName}</div>
                      </td>
                      <td>
                        <div className="project-value">{value}</div>
                      </td>
                      <td>
                        <span className={`project-status ${stat.className === 'normal' ? 'green' : 'red'}`}>
                          <span className="dot" />
                          {stat.className === 'normal' ? '正常' : '异常'}
                        </span>
                      </td>
                      <td>{timeText(snapshot)}</td>
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
    <section className="page-shell">
      <header className="page-header">
        <div className="page-copy">
          <h1>Dashboard</h1>
          <p>两大分组面板，Pressure 和 Flow 共用同一张趋势图，其余字段以数值和单位呈现</p>
        </div>
        <div className="page-meta">
          <span className="status-line">{dashboardGroups.length ? `${dashboardGroups.length} 个分组` : '暂无分组'}</span>
          <button type="button" className="soft-action" onClick={() => void refreshRuntime()} disabled={loading}>
            {loading ? '刷新中' : '刷新'}
          </button>
        </div>
      </header>

      <section className="dashboard-layout">
        {dashboardGroups.length > 0 ? (
          dashboardGroups.map((group) => {
            const pressureSnapshot = group.pressure ? snapshotByTagId.get(group.pressure.id) : undefined
            const flowSnapshot = group.flow ? snapshotByTagId.get(group.flow.id) : undefined
            const pressureUnit = inferUnit(group.pressure ? shortLabel(group.pressure) : 'Pressure')
            const flowUnit = inferUnit(group.flow ? shortLabel(group.flow) : 'Flow')
            const pressureText = group.pressure ? formatNumberWithUnit(toNumericValue(pressureSnapshot?.value ?? null), pressureUnit) : '暂无数据'
            const flowText = group.flow ? formatNumberWithUnit(toNumericValue(flowSnapshot?.value ?? null), flowUnit) : '暂无数据'

            return (
              <article key={group.name} className="dashboard-panel">
                <div className="panel-head">
                  <div>
                    <div className="panel-title">{group.name}</div>
                    <div className="panel-subtitle">{group.tags.length} 个点位 · 只显示数值和单位</div>
                  </div>
                  <span className="status-line">Pressure / Flow</span>
                </div>

                <div className="dashboard-chart-card">
                  <TrendChart
                    series={[
                      { label: 'Pressure', unit: pressureUnit, color: '#5d57ed', points: group.pressureSeries, current: pressureText },
                      { label: 'Flow', unit: flowUnit, color: '#1b9953', points: group.flowSeries, current: flowText },
                    ]}
                  />
                </div>

                <div className="dashboard-metrics">
                  <div className="dashboard-metric">
                    <span>Pressure</span>
                    <strong>{pressureText}</strong>
                  </div>
                  <div className="dashboard-metric">
                    <span>Flow</span>
                    <strong>{flowText}</strong>
                  </div>
                  {group.metrics.map((metric) => (
                    <div key={metric.tag.id} className="dashboard-metric">
                      <span>{metric.label}</span>
                      <strong>{metric.value}</strong>
                    </div>
                  ))}
                </div>
              </article>
            )
          })
        ) : (
          <div className="empty-dashboard">暂无 Dashboard 数据，请先连接设备并刷新。</div>
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
