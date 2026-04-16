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

const efficiencySimulationTailScenarios: Record<number, Array<{ stateKey: EfficiencySimulationStateKey; durationMs: number }>> = {
  1: [
    { stateKey: 'running', durationMs: 34 * 60_000 },
    { stateKey: 'fault', durationMs: 28 * 60_000 },
    { stateKey: 'standby', durationMs: 24 * 60_000 },
    { stateKey: 'disconnected', durationMs: 42 * 60_000 },
    { stateKey: 'running', durationMs: 30 * 60_000 },
    { stateKey: 'standby', durationMs: 26 * 60_000 },
  ],
  2: [
    { stateKey: 'standby', durationMs: 22 * 60_000 },
    { stateKey: 'disconnected', durationMs: 38 * 60_000 },
    { stateKey: 'running', durationMs: 32 * 60_000 },
    { stateKey: 'fault', durationMs: 30 * 60_000 },
    { stateKey: 'standby', durationMs: 24 * 60_000 },
    { stateKey: 'running', durationMs: 28 * 60_000 },
  ],
}


function createSeededRandom(seed: number) {
  let value = Math.floor(seed) % 2_147_483_647
  if (value <= 0) value += 2_147_483_646

  return () => {
    value = (value * 16_807) % 2_147_483_647
    return (value - 1) / 2_147_483_646
  }
}

function pickWeightedState(
  randomValue: number,
  entries: Array<readonly [EfficiencySimulationStateKey, number]>,
): EfficiencySimulationStateKey {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
  let cursor = randomValue * total

  for (const [stateKey, weight] of entries) {
    cursor -= weight
    if (cursor <= 0) return stateKey
  }

  return entries[entries.length - 1][0]
}

function getNextSimulationState(previousState: EfficiencySimulationStateKey | null, random: () => number) {
  if (previousState === null) {
    return pickWeightedState(random(), [
      ['standby', 0.34],
      ['running', 0.42],
      ['fault', 0.14],
      ['disconnected', 0.1],
    ])
  }

  if (previousState === 'running') {
    return pickWeightedState(random(), [
      ['running', 0.18],
      ['standby', 0.46],
      ['fault', 0.24],
      ['disconnected', 0.12],
    ])
  }

  if (previousState === 'standby') {
    return pickWeightedState(random(), [
      ['running', 0.52],
      ['standby', 0.18],
      ['fault', 0.12],
      ['disconnected', 0.18],
    ])
  }

  if (previousState === 'fault') {
    return pickWeightedState(random(), [
      ['standby', 0.58],
      ['running', 0.24],
      ['fault', 0.06],
      ['disconnected', 0.12],
    ])
  }

  return pickWeightedState(random(), [
    ['standby', 0.46],
    ['running', 0.24],
    ['disconnected', 0.2],
    ['fault', 0.1],
  ])
}

function getSimulationDurationMs(
  stateKey: EfficiencySimulationStateKey,
  random: () => number,
  segmentIndex: number,
) {
  const durationRangeByState: Record<EfficiencySimulationStateKey, readonly [number, number]> = {
    disconnected: [55 * 60_000, 135 * 60_000],
    standby: [18 * 60_000, 78 * 60_000],
    running: [22 * 60_000, 105 * 60_000],
    fault: [8 * 60_000, 26 * 60_000],
  }

  const [minDuration, maxDuration] = durationRangeByState[stateKey]
  const baseDuration = minDuration + Math.round(random() * (maxDuration - minDuration))
  const cadenceBoost = stateKey === 'running' && segmentIndex % 4 === 0 ? 8 * 60_000 : 0
  return baseDuration + cadenceBoost
}

function createSimulationSegment(
  faceplateIndex: number,
  stationName: string,
  stateKey: EfficiencySimulationStateKey,
  startedAtMs: number,
  endedAtMs: number,
): EfficiencyTimelineSegment {
  const state = efficiencySimulationStateMeta[stateKey]
  return {
    faceplateIndex,
    stationName,
    stateKey,
    stateLabel: state.label,
    colorHex: state.colorHex,
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date(endedAtMs).toISOString(),
    isDemo: true,
  }
}

function appendSimulationSegment(segments: EfficiencyTimelineSegment[], segment: EfficiencyTimelineSegment) {
  const previousSegment = segments[segments.length - 1]
  if (previousSegment && previousSegment.stateKey === segment.stateKey && previousSegment.endedAt === segment.startedAt) {
    previousSegment.endedAt = segment.endedAt
    return
  }

  segments.push(segment)
}

function buildScenarioSegments(
  lane: { faceplateIndex: number; stationName: string },
  windowStartMs: number,
  windowEndMs: number,
) {
  const scenario = efficiencySimulationTailScenarios[lane.faceplateIndex] ?? efficiencySimulationTailScenarios[1]
  const totalDurationMs = scenario.reduce((sum, item) => sum + item.durationMs, 0)
  let cursor = windowEndMs - totalDurationMs

  return scenario.flatMap((item, index) => {
    const rawStartMs = cursor
    const rawEndMs = index === scenario.length - 1 ? windowEndMs : cursor + item.durationMs
    cursor = rawEndMs

    const startedAtMs = Math.max(windowStartMs, rawStartMs)
    const endedAtMs = Math.min(windowEndMs, rawEndMs)
    if (endedAtMs <= startedAtMs) return []

    return [createSimulationSegment(lane.faceplateIndex, lane.stationName, item.stateKey, startedAtMs, endedAtMs)]
  })
}

function buildSimulatedLane(
  lane: { faceplateIndex: number; stationName: string },
  windowStartMs: number,
  windowEndMs: number,
): EfficiencyTimelineLane {
  const segments: EfficiencyTimelineSegment[] = []
  const scenario = efficiencySimulationTailScenarios[lane.faceplateIndex] ?? efficiencySimulationTailScenarios[1]
  const scenarioDurationMs = scenario.reduce((sum, item) => sum + item.durationMs, 0)
  const historyEndMs = Math.max(windowStartMs, windowEndMs - scenarioDurationMs)

  let cursor = windowStartMs
  let previousState: EfficiencySimulationStateKey | null = lane.faceplateIndex % 2 === 0 ? 'running' : 'standby'
  let segmentIndex = 0

  while (cursor < historyEndMs) {
    const seed = lane.faceplateIndex * 1_000_003 + Math.floor(cursor / 60_000) + segmentIndex * 97
    const random = createSeededRandom(seed)
    const stateKey = getNextSimulationState(previousState, random)
    const durationMs = getSimulationDurationMs(stateKey, random, segmentIndex)
    const nextCursor = Math.min(historyEndMs, cursor + durationMs)

    appendSimulationSegment(segments, createSimulationSegment(lane.faceplateIndex, lane.stationName, stateKey, cursor, nextCursor))

    previousState = stateKey
    cursor = nextCursor
    segmentIndex += 1
  }

  for (const segment of buildScenarioSegments(lane, windowStartMs, windowEndMs)) {
    appendSimulationSegment(segments, segment)
  }

  const currentSegment =
    segments[segments.length - 1] ??
    createSimulationSegment(lane.faceplateIndex, lane.stationName, 'standby', windowEndMs - 60_000, windowEndMs)

  return {
    faceplateIndex: lane.faceplateIndex,
    stationName: lane.stationName,
    currentStateKey: currentSegment.stateKey,
    currentStateLabel: currentSegment.stateLabel,
    currentColorHex: currentSegment.colorHex,
    segments,
  }
}


export async function getSimulatedEfficiencyTimeline(hours = 24) {
  const safeHours = Math.max(1, Math.min(72, Math.round(hours)))
  const windowEndMs = Date.now()
  const windowStartMs = windowEndMs - safeHours * 3_600_000

  return {
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: new Date(windowEndMs).toISOString(),
    generatedAt: new Date(windowEndMs).toISOString(),
    lanes: efficiencySimulationLanes.map((lane) => buildSimulatedLane(lane, windowStartMs, windowEndMs)),
  }
}

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
