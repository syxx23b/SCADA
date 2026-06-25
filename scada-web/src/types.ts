export interface DeviceConnection {
  id: string
  name: string
  driverKind: string
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
  driverKind: string
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

export interface SiemensDbImportTag {
  nodeId: string
  browseName: string
  displayName: string
  dataType: string
  groupKey: string
  allowWrite: boolean
}

export interface SiemensDbImportPreview {
  blockName: string
  total: number
  tags: SiemensDbImportTag[]
  warnings: string[]
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

export interface TagExcelReplaceResult {
  total: number
  created: number
  removed: number
  errors: string[]
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
  annualCurrentYearDaily: ProductionByDateBucket[]
  generatedAt: string
}

export interface FaultByGwResponse {
  date: string
  totalFaultCount: number
  totalQualifiedCount: number
  faultBuckets: ProductionByGwBucket[]
  qualifiedBuckets: ProductionByGwBucket[]
  quarterErrorDefinitions: FaultErrorDefinition[]
  quarterErrorDetails: FaultQuarterBucket[]
  quarterQualifiedDetails: ProductionByDateBucket[]
  generatedAt: string
}

export interface FaultErrorDefinition {
  err: number
  information: string
}

export interface FaultQuarterBucket {
  date: string
  err: number
  count: number
}

export interface ReworkLookupResponse {
  tm: string
  found: boolean
  sj: string | null
  gw: number | null
  orderNo: string | null
  err: number | null
  errInformation: string | null
  reworkSuggestions: string[]
  repairMeasures: string[]
}

export interface ReworkHistoryErrorItem {
  sj: string | null
  gw: number | null
  orderNo: string | null
  err: number | null
  errInformation: string | null
}

export interface ReworkHistoryRepairItem {
  confirmedAt: string
  repairMeasure: string
}

export interface ReworkHistoryResponse {
  tm: string
  errorItems: ReworkHistoryErrorItem[]
  repairItems: ReworkHistoryRepairItem[]
}

export interface RepairRecordConfirmRequest {
  tm: string | null
  sj: string | null
  gw: number | null
  orderNo: string | null
  err: number | null
  repairMeasure: string
}

export interface RepairRecordConfirmResponse {
  id: number
  confirmedAt: string
}

export interface RepairRecordItem {
  id: number
  sj: string
  tm: string
  err: number
  errInformation: string
  repairMeasure: string
  gw: number | null
  orderNo: string | null
  confirmedAt: string
}

export interface RepairRecordListResponse {
  from: string
  to: string
  items: RepairRecordItem[]
}

export interface RepairRecordDailyResponse {
  from: string
  to: string
  months: number
  daily: ProductionByDateBucket[]
}

export interface ReworkErrNode {
  err: number
  errInformation: string
}

export interface ReworkMeasureNode {
  id: number
  itemContent: string
}

export interface ReworkMappingEdge {
  id: number
  err: number
  knowledgeId: number
}

export interface ReworkConfigGraphResponse {
  errNodes: ReworkErrNode[]
  measureNodes: ReworkMeasureNode[]
  edges: ReworkMappingEdge[]
}

export interface ReworkSuggestionRow {
  id: number
  itemContent: string
}

export interface ReworkMeasureMappingRow {
  mappingId: number
  knowledgeId: number
  itemContent: string
}

export interface ReworkConfigEntriesResponse {
  err: number
  suggestions: ReworkSuggestionRow[]
  measures: ReworkMeasureMappingRow[]
  measureCatalog: ReworkMeasureNode[]
}
