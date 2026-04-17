import type {
  BrowseNode,
  DeviceConnection,
  DeviceFormState,
  EfficiencyTimelineLane,
  EfficiencyTimelineResponse,
  EfficiencyTimelineSegment,
  RuntimeOverview,
  TagDefinition,
  TagFormState,
  ProductionByGwResponse,
} from './types'



async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with status ${response.status}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export function getDevices() {
  return request<DeviceConnection[]>('/api/devices')
}

export function createDevice(payload: DeviceFormState) {
  return request<DeviceConnection>('/api/devices', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateDevice(id: string, payload: DeviceFormState) {
  return request<DeviceConnection>(`/api/devices/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function connectDevice(id: string) {
  return request<DeviceConnection>(`/api/devices/${id}/connect`, {
    method: 'POST',
  })
}

export function disconnectDevice(id: string) {
  return request<DeviceConnection>(`/api/devices/${id}/disconnect`, {
    method: 'POST',
  })
}

export function browseDevice(deviceId: string, nodeId?: string) {
  const query = nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ''
  return request<BrowseNode[]>(`/api/devices/${deviceId}/browse${query}`)
}

export function getTags() {
  return request<TagDefinition[]>('/api/tags')
}

export function createTag(payload: TagFormState) {
  return request<TagDefinition>('/api/tags', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateTag(id: string, payload: TagFormState) {
  return request<TagDefinition>(`/api/tags/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function deleteTag(id: string) {
  return request<void>(`/api/tags/${id}`, {
    method: 'DELETE',
  })
}

export interface WriteOperationResult {
  tagId: string
  succeeded: boolean
  statusCode: string
  message: string | null
}

export async function writeTag(tagId: string, value: string) {
  const result = await request<WriteOperationResult>(`/api/tags/${tagId}/write`, {
    method: 'POST',
    body: JSON.stringify({ value }),
  })

  if (!result.succeeded) {
    throw new Error(result.message || `写入失败 (${result.statusCode || 'Unknown'})`)
  }

  return result
}


export function getRuntimeOverview() {
  return request<RuntimeOverview>('/api/runtime/overview')
}

export function getEfficiencyTimeline(hours = 24) {
  return request<EfficiencyTimelineResponse>(`/api/efficiency/timeline?hours=${hours}`)
}

export function getProductionTodayByGw() {
  return request<ProductionByGwResponse>('/api/production/today-gw')
}

// ==================== 真实SCADA仿真系统 ====================
// 1. 独立运行的仿真器，每秒采样状态
// 2. 保存历史记录
// 3. 甘特图基于历史记录生成

type EfficiencySimulationStateKey = EfficiencyTimelineSegment['stateKey']

const efficiencySimulationStateMeta: Record<EfficiencySimulationStateKey, { label: string; colorHex: string }> = {
  disconnected: { label: '未工作', colorHex: '#dadce0' },
  standby: { label: '待机', colorHex: '#eace21' },
  running: { label: '测试中', colorHex: '#2eaa4a' },
  fault: { label: '报警处理', colorHex: '#ca3333' },
}

const efficiencySimulationLanes = [
  { faceplateIndex: 1, stationName: '工位 1' },
  { faceplateIndex: 2, stationName: '工位 2' },
] as const

// 历史记录接口
interface HistoryRecord {
  faceplateIndex: number
  stationName: string
  stateKey: EfficiencySimulationStateKey
  startedAt: number
  endedAt: number
}

// 当前仿真状态
interface CurrentSimState {
  stateKey: EfficiencySimulationStateKey
  startedAt: number
  durationMs: number
}

// localStorage 键名
const STORAGE_KEY_RECORDS = 'scada_simulation_records'
const STORAGE_KEY_STATES = 'scada_simulation_states'
const STORAGE_KEY_INIT_TIME = 'scada_simulation_init_time'

// 内存中的历史数据库 - Map<faceplateIndex, HistoryRecord[]>
const historyDatabase = new Map<number, HistoryRecord[]>()
const currentStates = new Map<number, CurrentSimState>()

// 仿真器定时器
let simulationTimer: number | null = null
let isInitialized = false

// 从 localStorage 加载数据
function loadFromStorage(): boolean {
  try {
    const recordsJson = localStorage.getItem(STORAGE_KEY_RECORDS)
    const statesJson = localStorage.getItem(STORAGE_KEY_STATES)
    const initTime = localStorage.getItem(STORAGE_KEY_INIT_TIME)

    if (!recordsJson || !statesJson || !initTime) return false

    // 检查数据是否超过12小时
    const initTimeMs = parseInt(initTime, 10)
    const now = Date.now()
    if (now - initTimeMs > 12 * 60 * 60_000) {
      // 数据过期，清除
      localStorage.removeItem(STORAGE_KEY_RECORDS)
      localStorage.removeItem(STORAGE_KEY_STATES)
      localStorage.removeItem(STORAGE_KEY_INIT_TIME)
      return false
    }

    const records = JSON.parse(recordsJson) as Record<string, HistoryRecord[]>
    const states = JSON.parse(statesJson) as Record<string, CurrentSimState>

    // 恢复到内存
    for (const [key, value] of Object.entries(records)) {
      historyDatabase.set(parseInt(key, 10), value)
    }
    for (const [key, value] of Object.entries(states)) {
      currentStates.set(parseInt(key, 10), value)
    }

    return true
  } catch {
    return false
  }
}

// 保存到 localStorage
function saveToStorage() {
  try {
    const records: Record<string, HistoryRecord[]> = {}
    for (const [key, value] of historyDatabase.entries()) {
      records[key] = value
    }

    const states: Record<string, CurrentSimState> = {}
    for (const [key, value] of currentStates.entries()) {
      states[key] = value
    }

    localStorage.setItem(STORAGE_KEY_RECORDS, JSON.stringify(records))
    localStorage.setItem(STORAGE_KEY_STATES, JSON.stringify(states))
  } catch {
    // 存储失败（可能是大小限制），忽略
  }
}

// 伪随机数生成器
// 状态轮流顺序: 未工作 → 待机 → 测试中 → 报警处理 → 未工作...
const STATE_CYCLE: EfficiencySimulationStateKey[] = ['disconnected', 'standby', 'running', 'fault']
const STATE_CYCLE_REVERSE: EfficiencySimulationStateKey[] = ['disconnected', 'fault', 'running', 'standby']
const CYCLE_DURATION_MS = 60 * 1000 // 每分钟切换一次

// 获取下一个状态（按顺序轮流，工位2倒序）
function getNextSimulationState(
  previousState: EfficiencySimulationStateKey | null,
  laneIndex: number,
): EfficiencySimulationStateKey {
  if (previousState === null) {
    return 'disconnected'
  }
  // 工位2使用倒序
  const cycle = laneIndex === 2 ? STATE_CYCLE_REVERSE : STATE_CYCLE
  const currentIndex = cycle.indexOf(previousState)
  const nextIndex = (currentIndex + 1) % cycle.length
  return cycle[nextIndex]
}

// 固定持续时间：每分钟切换
function getSimulationDurationMs(): number {
  return CYCLE_DURATION_MS
}

// 清空历史数据并重新开始采样
export function resetSimulation() {
  historyDatabase.clear()
  currentStates.clear()
  isInitialized = false
  localStorage.removeItem(STORAGE_KEY_RECORDS)
  localStorage.removeItem(STORAGE_KEY_STATES)
  localStorage.removeItem(STORAGE_KEY_INIT_TIME)
  initHistoryDatabase()
}

// 初始化历史数据库 - 优先从 localStorage 加载
function initHistoryDatabase() {
  if (isInitialized) return
  isInitialized = true

  // 尝试从 storage 加载
  if (loadFromStorage()) {
    // 恢复后继续更新当前记录
    const now = Date.now()
    for (const lane of efficiencySimulationLanes) {
      const records = historyDatabase.get(lane.faceplateIndex) ?? []
      const lastRecord = records[records.length - 1]
      const currentState = currentStates.get(lane.faceplateIndex)

      // 更新最后一条记录和当前状态的结束时间
      if (lastRecord) {
        lastRecord.endedAt = now
      }
      if (currentState) {
        // 检查是否需要进行状态转换
        while (now >= currentState.startedAt + currentState.durationMs) {
          const stateEndTime = currentState.startedAt + currentState.durationMs
          const newStateKey = getNextSimulationState(currentState.stateKey, lane.faceplateIndex)
          const durationMs = getSimulationDurationMs()

          // 创建新记录
          records.push({
            faceplateIndex: lane.faceplateIndex,
            stationName: lane.stationName,
            stateKey: newStateKey,
            startedAt: stateEndTime,
            endedAt: now,
          })

          currentState.stateKey = newStateKey
          currentState.startedAt = stateEndTime
          currentState.durationMs = durationMs
        }
      }
    }
    saveToStorage()
    return
  }

  // 首次初始化
  const now = Date.now()
  const startTime = now - 12 * 60 * 60_000 // 12小时前

  for (const lane of efficiencySimulationLanes) {
    const records: HistoryRecord[] = [
      {
        faceplateIndex: lane.faceplateIndex,
        stationName: lane.stationName,
        stateKey: 'disconnected',
        startedAt: startTime,
        endedAt: now,
      },
    ]

    historyDatabase.set(lane.faceplateIndex, records)

    currentStates.set(lane.faceplateIndex, {
      stateKey: 'disconnected',
      startedAt: now,
      durationMs: getSimulationDurationMs(),
    })
  }

  // 保存初始化时间
  localStorage.setItem(STORAGE_KEY_INIT_TIME, now.toString())
  saveToStorage()
}

// 仿真器 tick - 每秒调用一次
function simulationTick() {
  const now = Date.now()
  const retentionMs = 12 * 60 * 60_000 // 只保留12小时

  for (const lane of efficiencySimulationLanes) {
    const currentState = currentStates.get(lane.faceplateIndex)
    if (!currentState) continue

    const records = historyDatabase.get(lane.faceplateIndex) ?? []
    let lastRecord = records[records.length - 1]

    // 检查是否需要状态转换
    if (now >= currentState.startedAt + currentState.durationMs) {
      // 结束上一个记录
      if (lastRecord) {
        lastRecord.endedAt = currentState.startedAt + currentState.durationMs
      }

      // 生成新状态
      const newStateKey = getNextSimulationState(currentState.stateKey, lane.faceplateIndex)
      const durationMs = getSimulationDurationMs()
      const newStartAt = currentState.startedAt + currentState.durationMs

      // 创建新记录
      const newRecord: HistoryRecord = {
        faceplateIndex: lane.faceplateIndex,
        stationName: lane.stationName,
        stateKey: newStateKey,
        startedAt: newStartAt,
        endedAt: now,
      }
      records.push(newRecord)

      // 更新当前状态
      currentStates.set(lane.faceplateIndex, {
        stateKey: newStateKey,
        startedAt: newStartAt,
        durationMs,
      })
    } else {
      // 状态未变，更新当前记录的结束时间到当前时间
      if (lastRecord) {
        lastRecord.endedAt = now
      }
    }

    // 清理超过12小时的旧数据
    const cutoffTime = now - retentionMs
    while (records.length > 0 && records[0].endedAt < cutoffTime) {
      records.shift()
    }
  }

  // 保存到 localStorage
  saveToStorage()
}

// 启动仿真器
function startSimulation() {
  if (simulationTimer !== null) return
  initHistoryDatabase()
  simulationTimer = window.setInterval(simulationTick, 1000)
}

// 获取当前状态（供实时监控使用）
export function getCurrentSimulationState(laneIndex: number): {
  stateKey: EfficiencySimulationStateKey
  stateLabel: string
  colorHex: string
} {
  startSimulation()
  const state = currentStates.get(laneIndex)
  const stateKey = state?.stateKey ?? 'standby'
  const meta = efficiencySimulationStateMeta[stateKey]
  return {
    stateKey,
    stateLabel: meta.label,
    colorHex: meta.colorHex,
  }
}

// 基于历史记录生成甘特图数据
export async function getSimulatedEfficiencyTimeline(hours = 24): Promise<EfficiencyTimelineResponse> {
  startSimulation()

  const safeHours = Math.max(1, Math.min(72, Math.round(hours)))
  const windowEndMs = Date.now()
  const windowStartMs = windowEndMs - safeHours * 3_600_000

  const lanes: EfficiencyTimelineLane[] = efficiencySimulationLanes.map((lane) => {
    const allRecords = historyDatabase.get(lane.faceplateIndex) ?? []

    // 过滤在窗口范围内的记录
    const segments: EfficiencyTimelineSegment[] = allRecords
      .filter((record) => record.endedAt > windowStartMs && record.startedAt < windowEndMs)
      .map((record) => {
        const meta = efficiencySimulationStateMeta[record.stateKey]
        return {
          faceplateIndex: record.faceplateIndex,
          stationName: record.stationName,
          stateKey: record.stateKey,
          stateLabel: meta.label,
          colorHex: meta.colorHex,
          startedAt: new Date(Math.max(record.startedAt, windowStartMs)).toISOString(),
          endedAt: new Date(Math.min(record.endedAt, windowEndMs)).toISOString(),
          isDemo: true,
        }
      })

    // 获取当前状态
    const currentState = currentStates.get(lane.faceplateIndex)
    const currentStateKey = currentState?.stateKey ?? 'standby'
    const currentMeta = efficiencySimulationStateMeta[currentStateKey]

    return {
      faceplateIndex: lane.faceplateIndex,
      stationName: lane.stationName,
      currentStateKey,
      currentStateLabel: currentMeta.label,
      currentColorHex: currentMeta.colorHex,
      segments,
    }
  })

  return {
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: new Date(windowEndMs).toISOString(),
    generatedAt: new Date(windowEndMs).toISOString(),
    lanes,
  }
}

// ==================== 其他API ====================

export function openVncTool(host: string) {
  return request<{ message: string }>('/api/tools/vnc/open', {
    method: 'POST',
    body: JSON.stringify({ host }),
  })
}

// 配方相关 API
export interface Recipe {
  id: string
  name: string
  description: string
  recipeType: string
  createdAt: string
  updatedAt: string
}

export interface RecipeDetail extends Recipe {
  items: Record<string, string>
}

export function getRecipes(type?: string) {
  const query = type ? `?type=${encodeURIComponent(type)}` : ''
  return request<Recipe[]>(`/api/recipes${query}`)
}

export function getRecipe(id: string) {
  return request<RecipeDetail>(`/api/recipes/${id}`)
}

export function createRecipe(payload: { name: string; description: string; recipeType: string; items: Record<string, string> }) {
  return request<Recipe>('/api/recipes', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateRecipe(id: string, payload: { name: string; description: string; items: Record<string, string> }) {
  return request<Recipe>(`/api/recipes/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function deleteRecipe(id: string) {
  return request<void>(`/api/recipes/${id}`, {
    method: 'DELETE',
  })
}
