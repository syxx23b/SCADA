export interface DeviceConnection {
  id: string
  name: string
  endpointUrl: string
  securityMode: string
  securityPolicy: string
  authMode: string
  username: string | null
  autoConnect: boolean
  status: string
  updatedAt: string
}

export interface DeviceFormState {
  id?: string
  name: string
  endpointUrl: string
  securityMode: string
  securityPolicy: string
  authMode: string
  username: string
  password: string
  autoConnect: boolean
}

export interface TagDefinition {
  id: string
  deviceId: string
  nodeId: string
  browseName: string
  displayName: string
  dataType: string
  samplingIntervalMs: number
  publishingIntervalMs: number
  allowWrite: boolean
  enabled: boolean
  groupKey: string | null
  updatedAt: string
}

export interface TagFormState {
  id?: string
  deviceId: string
  nodeId: string
  browseName: string
  displayName: string
  dataType: string
  samplingIntervalMs: number
  publishingIntervalMs: number
  allowWrite: boolean
  enabled: boolean
  groupKey: string
}

export interface BrowseNode {
  nodeId: string
  browseName: string
  displayName: string
  nodeClass: string
  hasChildren: boolean
  dataType: string | null
  writable: boolean
}

export interface TagSnapshot {
  tagId: string
  deviceId: string
  value: string | number | boolean | null
  quality: string
  sourceTimestamp: string | null
  serverTimestamp: string | null
  connectionState: string
}

export interface RuntimeDevice {
  deviceId: string
  deviceName: string
  status: string
  endpointUrl: string
  enabledTagCount: number
  writableTagCount: number
}

export interface RuntimeOverview {
  devices: RuntimeDevice[]
  tags: TagDefinition[]
  snapshots: TagSnapshot[]
}

export interface EfficiencyTimelineSegment {
  faceplateIndex: number
  stationName: string
  stateKey: 'disconnected' | 'standby' | 'running' | 'fault'
  stateLabel: string
  colorHex: string
  startedAt: string
  endedAt: string
  isDemo: boolean
}

export interface EfficiencyTimelineLane {
  faceplateIndex: number
  stationName: string
  currentStateKey: 'disconnected' | 'standby' | 'running' | 'fault'
  currentStateLabel: string
  currentColorHex: string
  segments: EfficiencyTimelineSegment[]
}

export interface EfficiencyTimelineResponse {
  windowStart: string
  windowEnd: string
  generatedAt: string
  lanes: EfficiencyTimelineLane[]
}

export interface DeviceStatusChanged {

  deviceId: string
  status: string
  message: string
  occurredAt: string
}

export interface ProductionByGwBucket {
  gw: number
  count: number
}

export interface ProductionByDateBucket {
  date: string
  count: number
}

export interface ProductionByMonthBucket {
  month: string
  count: number
}

export interface ProductionByGwResponse {
  date: string
  totalCount: number
  buckets: ProductionByGwBucket[]
  dailyLast30Years: ProductionByDateBucket[]
  monthlyLast12Months: ProductionByMonthBucket[]
  generatedAt: string
}

export interface FaultByGwResponse {
  date: string
  totalFaultCount: number
  totalQualifiedCount: number
  faultBuckets: ProductionByGwBucket[]
  qualifiedBuckets: ProductionByGwBucket[]
  quarterErrorDetails: FaultQuarterBucket[]
  quarterQualifiedDetails: ProductionByDateBucket[]
  generatedAt: string
}


export interface FaultQuarterBucket {
  date: string
  err: number
  count: number
}
