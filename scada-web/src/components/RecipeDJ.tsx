import { useEffect, useMemo, useRef, useState } from 'react'
import type { TagDefinition, TagSnapshot } from '../types'
import './Recipe.css'

interface RecipeFile {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

interface RecipeDJProps {
  sourceTags: TagDefinition[]
  allTags: TagDefinition[]
  snapshots: Map<string, TagSnapshot>

  onWrite: (tagId: string, value: string) => Promise<boolean>

  savingTagId: string | null
  savedRecipes: RecipeFile[]
  onSaveRecipe: (recipeName: string, recipeData: Record<string, string>) => Promise<boolean>
  onLoadRecipe: (recipeId: string) => Promise<boolean>
  onDeleteRecipe: (recipeId: string) => Promise<boolean>
  loadedRecipeName?: string
  showRecipe1SyncButton: boolean
  showRecipe2SyncButton: boolean
  disableRecipe1SyncButton?: boolean
  disableRecipe2SyncButton?: boolean
  recipe1SyncLabel: string
  recipe2SyncLabel: string
}


type RecipeRow = {
  tag: TagDefinition
  fieldKey: string
  label: string
  subLabel: string
  group: string
  unit: string
  valueText: string
  updatedText: string
}

type IndexedRecipeRow = RecipeRow & {
  seq: number
}

type FeedbackTone = 'success' | 'warning' | 'error'

type SyncIssueRow = {
  target: string
  source: string
  value: string
  reason: string
}

const SYNC_WRITE_TIMEOUT_MS = 4000
const RECIPE_CARD_GROUPS = ['全局设置', '出厂测试', '耐久测试', '泵头性能'] as const

function getSimulatedFieldValue(fieldKey: string) {
  const key = fieldKey.toLowerCase()
  if (key === 'recipename') return 'SIM-DJ-001'
  if (key === 'motortype') return '2'
  if (key === 'nobarcodestart') return '89'
  if (key === 'dcholdingpoweroff') return '1'
  if (key.includes('flow')) return key.includes('max') ? '8.80' : '6.60'
  if (key.includes('pressure') || key.includes('drop')) return key.includes('max') ? '13.50' : '8.20'
  if (key.includes('current')) return key.includes('max') ? '12.40' : '7.60'
  if (key.includes('time')) return '30'
  if (key.includes('count') || key.includes('interval')) return '12'
  if (key.includes('frequency')) return '5'
  if (key.includes('barcode')) return '16'
  return '1'
}

function getSnapshotOrSimulated(tag: TagDefinition, fieldKey: string, snapshots: Map<string, TagSnapshot>) {
  const actual = snapshots.get(tag.id)
  if (actual) return actual

  const timestamp = new Date().toISOString()
  return {
    tagId: tag.id,
    deviceId: tag.deviceId,
    value: getSimulatedFieldValue(fieldKey),
    quality: 'Good',
    sourceTimestamp: timestamp,
    serverTimestamp: timestamp,
    connectionState: 'LocalStatic',
  } satisfies TagSnapshot
}

const DJ_FIELD_ORDER = [

  'recipeName',
  'motorType',
  'barcodeLength',
  'noBarcodeStart',
  'dcHoldingPowerOff',
  'inletCleanTime',
  'lowStartCount',
  'lowStartCurrent',
  'highVoltageTime',
  'highBreakInTime',
  'highBreakInCount',
  'triggerOnTime',
  'triggerOffTime',
  'triggerCount',
  'siphonTime',
  'siphon',
  'pressureHoldTime',
  'holdingPressureDrop',
  'blowTime',
  'self_priming',
  'self_primingTime',
  'dcHoldingPowerOff',
  'enduranceTime',
  'enduranceTriggerOnTime',
  'enduranceTriggerOffTime',
  'pressureHoldingInterval',
  'enduranceInletMonitor',
  'dataUploadFrequency',
  'pressureMin',
  'pressureMax',
  'holdingPressureMin',
  'holdingPressureMax',
  'recoilPressureMin',
  'recoilPressureMax',
  'currentMin',
  'currentMax',
  'triggerOffCurrentMin',
  'triggerOffCurrentMax',
  'flowMin',
  'flowMax',
] as const

const DJ_SYNC_FIELDS = [
  { fieldKey: 'recipename', sourcePath: 'Local.RecipeName', targetField: 'RecipeName' },
  { fieldKey: 'motortype', sourcePath: 'Local.RecipeDJ.motorType', targetField: 'motorType' },
  { fieldKey: 'barcodelength', sourcePath: 'Local.RecipeDJ.barcodeLength', targetField: 'barcodeLength' },
  { fieldKey: 'nobarcodestart', sourcePath: 'Local.RecipeDJ.noBarcodeStart', targetField: 'noBarcodeStart' },
  { fieldKey: 'dcholdingpoweroff', sourcePath: 'Local.RecipeDJ.dcHoldingPowerOff', targetField: 'dcHoldingPowerOff' },
  { fieldKey: 'inletcleantime', sourcePath: 'Local.RecipeDJ.inletCleanTime', targetField: 'inletCleanTime' },
  { fieldKey: 'lowstartcount', sourcePath: 'Local.RecipeDJ.lowStartCount', targetField: 'lowStartCount' },
  { fieldKey: 'lowstartcurrent', sourcePath: 'Local.RecipeDJ.lowStartCurrent', targetField: 'lowStartCurrent' },
  { fieldKey: 'highvoltagetime', sourcePath: 'Local.RecipeDJ.highVoltageTime', targetField: 'highVoltageTime' },
  { fieldKey: 'highbreakintime', sourcePath: 'Local.RecipeDJ.highBreakInTime', targetField: 'highBreakInTime' },
  { fieldKey: 'highbreakincount', sourcePath: 'Local.RecipeDJ.highBreakInCount', targetField: 'highBreakInCount' },
  { fieldKey: 'triggerontime', sourcePath: 'Local.RecipeDJ.triggerOnTime', targetField: 'triggerOnTime' },
  { fieldKey: 'triggerofftime', sourcePath: 'Local.RecipeDJ.triggerOffTime', targetField: 'triggerOffTime' },
  { fieldKey: 'triggercount', sourcePath: 'Local.RecipeDJ.triggerCount', targetField: 'triggerCount' },
  { fieldKey: 'siphontime', sourcePath: 'Local.RecipeDJ.siphonTime', targetField: 'siphonTime' },
  { fieldKey: 'siphon', sourcePath: 'Local.RecipeDJ.siphon', targetField: 'siphon' },
  { fieldKey: 'pressureholdtime', sourcePath: 'Local.RecipeDJ.pressureHoldTime', targetField: 'pressureHoldTime' },
  { fieldKey: 'holdingpressuredrop', sourcePath: 'Local.RecipeDJ.holdingPressureDrop', targetField: 'holdingPressureDrop' },
  { fieldKey: 'blowtime', sourcePath: 'Local.RecipeDJ.blowTime', targetField: 'blowTime' },
  { fieldKey: 'self_priming', sourcePath: 'Local.RecipeDJ.self_priming', targetField: 'self_priming' },
  { fieldKey: 'self_primingtime', sourcePath: 'Local.RecipeDJ.self_primingTime', targetField: 'self_primingTime' },
  { fieldKey: 'endurancetime', sourcePath: 'Local.RecipeDJ.enduranceTime', targetField: 'enduranceTime' },
  { fieldKey: 'endurancetriggerontime', sourcePath: 'Local.RecipeDJ.enduranceTriggerOnTime', targetField: 'enduranceTriggerOnTime' },
  { fieldKey: 'endurancetriggerofftime', sourcePath: 'Local.RecipeDJ.enduranceTriggerOffTime', targetField: 'enduranceTriggerOffTime' },
  { fieldKey: 'pressureholdinginterval', sourcePath: 'Local.RecipeDJ.pressureHoldingInterval', targetField: 'pressureHoldingInterval' },
  { fieldKey: 'enduranceinletmonitor', sourcePath: 'Local.RecipeDJ.enduranceInletMonitor', targetField: 'enduranceInletMonitor' },
  { fieldKey: 'datauploadfrequency', sourcePath: 'Local.RecipeDJ.dataUploadFrequency', targetField: 'dataUploadFrequency' },
  { fieldKey: 'pressuremin', sourcePath: 'Local.RecipeDJ.pressureMin', targetField: 'pressureMin' },
  { fieldKey: 'pressuremax', sourcePath: 'Local.RecipeDJ.pressureMax', targetField: 'pressureMax' },
  { fieldKey: 'holdingpressuremin', sourcePath: 'Local.RecipeDJ.holdingPressureMin', targetField: 'holdingPressureMin' },
  { fieldKey: 'holdingpressuremax', sourcePath: 'Local.RecipeDJ.holdingPressureMax', targetField: 'holdingPressureMax' },
  { fieldKey: 'recoilpressuremin', sourcePath: 'Local.RecipeDJ.recoilPressureMin', targetField: 'recoilPressureMin' },
  { fieldKey: 'recoilpressuremax', sourcePath: 'Local.RecipeDJ.recoilPressureMax', targetField: 'recoilPressureMax' },
  { fieldKey: 'currentmin', sourcePath: 'Local.RecipeDJ.currentMin', targetField: 'currentMin' },
  { fieldKey: 'currentmax', sourcePath: 'Local.RecipeDJ.currentMax', targetField: 'currentMax' },
  { fieldKey: 'triggeroffcurrentmin', sourcePath: 'Local.RecipeDJ.triggerOffCurrentMin', targetField: 'triggerOffCurrentMin' },
  { fieldKey: 'triggeroffcurrentmax', sourcePath: 'Local.RecipeDJ.triggerOffCurrentMax', targetField: 'triggerOffCurrentMax' },
  { fieldKey: 'flowmin', sourcePath: 'Local.RecipeDJ.flowMin', targetField: 'flowMin' },
  { fieldKey: 'flowmax', sourcePath: 'Local.RecipeDJ.flowMax', targetField: 'flowMax' },
] as const

type FieldMeta = {
  label: string
  unit?: string
  group?: string
}

type DictionaryOption = {
  label: string
  value: string
}

const NO_BARCODE_START_OPTIONS: readonly DictionaryOption[] = [
  { label: 'YES', value: '89' },
  { label: 'NO', value: '78' },
] as const

const MOTOR_TYPE_OPTIONS: readonly DictionaryOption[] = [
  { label: '未选择', value: '0' },
  { label: '单相电机', value: '1' },
  { label: '直流电机', value: '2' },
  { label: '三相电机', value: '3' },
] as const

const DC_HOLDING_POWER_OFF_OPTIONS: readonly DictionaryOption[] = [
  { label: '是', value: '0' },
  { label: '否', value: '1' },
] as const

const DJ_GROUP_WEIGHT: Record<string, number> = {

  '全局设置': 0,
  '出厂测试': 1,
  '耐久测试': 2,
  '泵头性能': 3,
  '其他参数': 4,
}

const DJ_FIELD_META: Record<string, FieldMeta> = {
  recipename: { label: '型号', unit: '', group: '全局设置' },
  motortype: { label: '电机类型', unit: '', group: '全局设置' },
  barcodelength: { label: '条码长度', unit: '位', group: '全局设置' },
  nobarcodestart: { label: '无条码启动', unit: '', group: '全局设置' },
  inletcleantime: { label: '进水扫膛时间', unit: '秒', group: '出厂测试' },
  lowstartcount: { label: '低压启动次数', unit: '次', group: '出厂测试' },
  lowstartcurrent: { label: '低压启动电流', unit: 'A', group: '出厂测试' },
  highvoltagetime: { label: '高压时间', unit: '秒', group: '出厂测试' },
  highbreakintime: { label: '高压磨合时间', unit: '秒', group: '出厂测试' },
  highbreakincount: { label: '高压磨合次数', unit: '次', group: '出厂测试' },
  triggerontime: { label: '开枪时间', unit: '秒', group: '出厂测试' },
  triggerofftime: { label: '关枪时间', unit: '秒', group: '出厂测试' },
  triggercount: { label: '开关枪次数', unit: '次', group: '出厂测试' },
  siphon: { label: '虹吸能力', unit: 'KPa', group: '出厂测试' },
  siphontime: { label: '虹吸时间', unit: '秒', group: '出厂测试' },
  blowtime: { label: '吹气清理时间', unit: '秒', group: '出厂测试' },
  pressureholdtime: { label: '保压时间', unit: '秒', group: '出厂测试' },
  holdingpressuredrop: { label: '保压压降', unit: 'MPa', group: '出厂测试' },
  self_priming: { label: '自吸能力', unit: 'KPa', group: '出厂测试' },
  self_primingtime: { label: '自吸时间', unit: '秒', group: '出厂测试' },
  dcholdingpoweroff: { label: '关枪通电', unit: '', group: '全局设置' },
  endurancetime: { label: '耐久时间', unit: '小时', group: '耐久测试' },
  endurancetriggerontime: { label: '耐久开枪时间', unit: '秒', group: '耐久测试' },
  endurancetriggerofftime: { label: '耐久关枪时间', unit: '秒', group: '耐久测试' },
  enduranceinletmonitor: { label: '水压监控', unit: 'Bar', group: '耐久测试' },
  datauploadfrequency: { label: '保存频率', unit: '分钟', group: '耐久测试' },
  pressureholdinginterval: { label: '保压间隔', unit: '次', group: '耐久测试' },
  pressuremin: { label: '工作压力下限', unit: 'MPa', group: '泵头性能' },
  pressuremax: { label: '工作压力上限', unit: 'MPa', group: '泵头性能' },
  holdingpressuremin: { label: '保压压力下限', unit: 'MPa', group: '泵头性能' },
  holdingpressuremax: { label: '保压压力上限', unit: 'MPa', group: '泵头性能' },
  recoilpressuremin: { label: '反冲压力下限', unit: 'MPa', group: '泵头性能' },
  recoilpressuremax: { label: '反冲压力上限', unit: 'MPa', group: '泵头性能' },
  currentmin: { label: '电流下限', unit: 'A', group: '泵头性能' },
  currentmax: { label: '电流上限', unit: 'A', group: '泵头性能' },
  triggeroffcurrentmin: { label: '关枪电流下限', unit: 'A', group: '泵头性能' },
  triggeroffcurrentmax: { label: '关枪电流上限', unit: 'A', group: '泵头性能' },
  flowmin: { label: '流量下限', unit: 'L/M', group: '泵头性能' },
  flowmax: { label: '流量上限', unit: 'L/M', group: '泵头性能' },
}

const DJ_FIELD_PATTERNS = [
  /^Local\.recipeName$/i,
  /^Local\.RecipeName$/i,
  /^Local\.Recipe_DB\.RecipeName$/i,
  /^Local\.Recipe_DB_RecipeName$/i,
  /^LocalVariable\.RecipeName$/i,
  /^Local\.RecipeDJ\.(.+)$/i,
  /^Local\.Recipe_DB\.DJRecipe(?:\[\d+\])?\.(.+)$/i,
  /^Local\.Recipe_DB_DJRecipe(?:\[\d+\])?_(.+)$/i,
  /^LocalVariable\.DJRecipe\.(.+)$/i,
] as const

const DJ_HIDDEN_FIELDS = new Set(['self_priming', 'self_primingtime'])

function normalizeTagPath(rawValue: string) {
  const trimmed = rawValue.trim()
  const nodeIdIndex = trimmed.indexOf(';s=')
  return nodeIdIndex >= 0 ? trimmed.slice(nodeIdIndex + 3) : trimmed
}

function extractFieldKey(tag: TagDefinition) {
  const candidates = [tag.displayName, tag.browseName, tag.nodeId]

  for (const rawValue of candidates) {
    const value = normalizeTagPath(rawValue ?? '')
    if (!value) continue


    for (const pattern of DJ_FIELD_PATTERNS) {
      const match = value.match(pattern)
      if (match) {
        // 对于 recipeName 模式，没有捕获组，直接返回 'recipeName'
        if (match[1] === undefined) return 'recipeName'
        return match[1].trim().replace(/^_+/, '')
      }
    }
  }

  return null
}

function getFieldMeta(fieldKey: string) {
  return DJ_FIELD_META[fieldKey.toLowerCase()]
}

function findTagByFieldKey(tags: TagDefinition[], fieldKey: string) {
  return tags.find((tag) => extractFieldKey(tag)?.toLowerCase() === fieldKey.toLowerCase()) ?? null
}

function normalizeNumericText(rawValue: string) {
  const trimmed = rawValue.trim()
  const match = trimmed.match(/^([+-]?)(\d+)(\.\d+)?$/)
  if (!match) return trimmed

  const [, sign, integerPart, decimalPart = ''] = match
  const normalizedIntegerPart = integerPart.replace(/^0+(?=\d)/, '')
  return `${sign}${normalizedIntegerPart}${decimalPart}`
}

function getSnapshotRawValue(snapshot: TagSnapshot | undefined) {
  if (snapshot?.value === null || snapshot?.value === undefined || snapshot.value === '') return ''
  if (typeof snapshot.value === 'boolean') return snapshot.value ? '1' : '0'
  return normalizeNumericText(String(snapshot.value))
}


function inferGroup(fieldKey: string) {
  return getFieldMeta(fieldKey)?.group ?? '其他参数'
}

function inferUnit(fieldKey: string, dataType: string) {
  const explicitUnit = getFieldMeta(fieldKey)?.unit
  if (explicitUnit !== undefined) return explicitUnit

  const key = fieldKey.toLowerCase()
  if (key === 'recipename') return ''
  if (/bool/i.test(dataType)) return ''
  if (key.includes('pressure') || key.includes('drop')) return 'MPa'
  if (key.includes('flow')) return 'L/M'
  if (key.includes('current')) return 'A'
  if (key.includes('frequency')) return 'Hz'
  if (key.includes('time')) return '秒'
  if (key.includes('count') || key.includes('interval')) return '次'
  if (key.includes('barcodelength')) return '位'
  return ''
}

function getFieldOptions(fieldKey: string) {
  const key = fieldKey.toLowerCase()
  if (key === 'motortype') return MOTOR_TYPE_OPTIONS
  if (key === 'nobarcodestart') return NO_BARCODE_START_OPTIONS
  if (key === 'dcholdingpoweroff') return DC_HOLDING_POWER_OFF_OPTIONS
  return null
}


function normalizeDcHoldingPowerOffValue(rawValue: string) {
  const normalized = rawValue.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === '否') return '1'
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === '是') return '0'
  return rawValue.trim()
}

function normalizeNoBarcodeStartValue(rawValue: string) {
  const normalized = rawValue.trim().toLowerCase()
  if (normalized === '89' || normalized === 'yes' || normalized === 'true') return '89'
  if (normalized === '78' || normalized === '0' || normalized === 'no' || normalized === 'false') return '78'
  return rawValue.trim()
}

function resolveDictionaryValue(fieldKey: string, valueText: string) {
  const options = getFieldOptions(fieldKey)
  if (!options) return valueText

  const key = fieldKey.toLowerCase()
  const raw = normalizeNumericText(valueText)
  const normalized = key === 'dcholdingpoweroff'
    ? normalizeDcHoldingPowerOffValue(raw)
    : key === 'nobarcodestart'
      ? normalizeNoBarcodeStartValue(raw)
      : raw
  if (!normalized || normalized === '—') return options[0].value

  const matchedByValue = options.find((item) => item.value === normalized)
  if (matchedByValue) return matchedByValue.value

  const matchedByLabel = options.find((item) => item.label.toLowerCase() === normalized.toLowerCase())
  return matchedByLabel?.value ?? options[0].value
}



function formatSnapshotValue(fieldKey: string, tag: TagDefinition, snapshot: TagSnapshot | undefined) {
  const options = getFieldOptions(fieldKey)
  if (options) {
    const key = fieldKey.toLowerCase()
    const rawValue = snapshot?.value === null || snapshot?.value === undefined || snapshot.value === ''
      ? options[0].value
      : normalizeNumericText(String(snapshot.value))
    const normalizedValue = key === 'dcholdingpoweroff'
      ? normalizeDcHoldingPowerOffValue(rawValue)
      : key === 'nobarcodestart'
        ? normalizeNoBarcodeStartValue(rawValue)
        : rawValue
    return options.find((item) => item.value === normalizedValue)?.label ?? normalizedValue
  }


  if (snapshot?.value === null || snapshot?.value === undefined || snapshot.value === '') return '—'
  if (typeof snapshot.value === 'number') {
    if (/float|double|single|decimal/i.test(tag.dataType)) return snapshot.value.toFixed(2)
    return String(snapshot.value)
  }
  if (typeof snapshot.value === 'boolean') return snapshot.value ? 'True' : 'False'
  return fieldKey.toLowerCase() === 'recipename' ? String(snapshot.value).trim() : normalizeNumericText(String(snapshot.value))
}


function formatTimestamp(snapshot: TagSnapshot | undefined) {
  if (!snapshot?.sourceTimestamp) return '—'
  const date = new Date(snapshot.sourceTimestamp)
  if (Number.isNaN(date.getTime())) return '—'
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`
}

function compareRows(left: RecipeRow, right: RecipeRow) {
  const groupWeight = (DJ_GROUP_WEIGHT[left.group] ?? 99) - (DJ_GROUP_WEIGHT[right.group] ?? 99)
  if (groupWeight !== 0) return groupWeight

  const leftIndex = DJ_FIELD_ORDER.indexOf(left.fieldKey as (typeof DJ_FIELD_ORDER)[number])
  const rightIndex = DJ_FIELD_ORDER.indexOf(right.fieldKey as (typeof DJ_FIELD_ORDER)[number])
  const safeLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex
  const safeRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex
  if (safeLeft !== safeRight) return safeLeft - safeRight
  return left.fieldKey.localeCompare(right.fieldKey, 'zh-CN', { numeric: true, sensitivity: 'base' })
}

function ValueEditor({
  tag,
  fieldKey,
  valueText,
  onWrite,
  savingTagId,
}: {
  tag: TagDefinition
  fieldKey: string
  valueText: string
  onWrite: (tagId: string, value: string) => Promise<boolean>
  savingTagId: string | null
}) {

  const options = getFieldOptions(fieldKey)
  const currentValue = options ? resolveDictionaryValue(fieldKey, valueText) : valueText === '—' ? '' : valueText
  const [draft, setDraft] = useState(currentValue)

  useEffect(() => {
    setDraft(currentValue)
  }, [currentValue, tag.id])

  // 型号字段只读
  if (fieldKey.toLowerCase() === 'recipename') return <span className="recipe-readonly recipe-readonly-value">{valueText}</span>

  if (!tag.allowWrite) return <span className="recipe-readonly recipe-readonly-value">{valueText}</span>

  const disabled = savingTagId === tag.id
  const commit = () => {
    const nextValue = normalizeNumericText(draft)
    if (nextValue !== draft) {
      setDraft(nextValue)
    }
    if (disabled || nextValue === '' || nextValue === currentValue.trim()) return
    onWrite(tag.id, nextValue)
  }


  if (options) {
    if (options.length === 2) {
      const currentOption = options.find((option) => option.value === draft) ?? options[0]
      const nextOption = options.find((option) => option.value !== currentOption.value) ?? options[0]

      return (
        <div className="recipe-editor recipe-editor-inline">
          <button
            type="button"
            className="recipe-editor-input recipe-editor-select"
            disabled={disabled}
            aria-label={`切换 ${tag.displayName}`}
            onClick={() => {
              if (disabled || nextOption.value === currentValue) return
              setDraft(nextOption.value)
              onWrite(tag.id, nextOption.value)
            }}
          >
            {currentOption.label}
          </button>
          {disabled ? <span className="recipe-editor-status">保存中</span> : null}
        </div>
      )
    }

    return (
      <div className="recipe-editor recipe-editor-inline">
        <select
          className="recipe-editor-input recipe-editor-select"
          value={draft}
          disabled={disabled}
          aria-label={`切换 ${tag.displayName}`}
          onChange={(event) => {
            const nextValue = event.target.value
            setDraft(nextValue)
            if (disabled || nextValue === currentValue) return
            onWrite(tag.id, nextValue)
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {disabled ? <span className="recipe-editor-status">保存中</span> : null}
      </div>
    )
  }

  const isIntegerType = /int|integer|long|short|byte/i.test(tag.dataType)
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    let value = event.target.value
    if (isIntegerType) {
      // 整数类型：只允许数字和负号，禁止小数点
      value = value.replace(/[^\d-]/g, '')
      // 确保负号只能在开头
      const parts = value.split('-')
      if (parts.length > 1) {
        value = (parts[0] ? '' : '-') + parts.join('').replace(/-/g, '')
      }
    }
    setDraft(value)
  }

  return (
    <div className="recipe-editor recipe-editor-inline">
      <input
        className="recipe-editor-input"
        value={draft}
        disabled={disabled}
        onChange={handleChange}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(currentValue)
            event.currentTarget.blur()
          }
        }}
        aria-label={`修改 ${tag.displayName}`}
        placeholder="直接输入，回车或失焦保存"
      />
      {disabled ? <span className="recipe-editor-status">保存中</span> : null}
    </div>
  )
}

export function RecipeDJ({
  sourceTags,
  allTags,
  snapshots,
  onWrite,
  savingTagId,
  savedRecipes,
  onSaveRecipe,
  onLoadRecipe,
  onDeleteRecipe,
  loadedRecipeName,
  showRecipe1SyncButton,
  showRecipe2SyncButton,
  disableRecipe1SyncButton = false,
  disableRecipe2SyncButton = false,
  recipe1SyncLabel,
  recipe2SyncLabel,
}: RecipeDJProps) {
  const motorTypeTag = useMemo(() => findTagByFieldKey(sourceTags, 'motorType'), [sourceTags])
  const dcHoldingPowerOffTag = useMemo(() => findTagByFieldKey(sourceTags, 'dcHoldingPowerOff'), [sourceTags])

  const motorTypeSnapshot = motorTypeTag ? getSnapshotOrSimulated(motorTypeTag, 'motorType', snapshots) : undefined
  const motorTypeValue = motorTypeTag ? getSnapshotRawValue(motorTypeSnapshot) : ''
  const shouldShowDcHoldingPowerOff = motorTypeValue === '2'

  // 配方名称输入框状态（独立于型号标签）
  const [recipeFileName, setRecipeFileName] = useState('')

  // 选中的配方ID
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>('')

  // 反馈消息状态
  const [feedbackMessage, setFeedbackMessage] = useState<string>('')
  const [feedbackTone, setFeedbackTone] = useState<FeedbackTone>('success')
  const [syncIssueRows, setSyncIssueRows] = useState<SyncIssueRow[]>([])
  const [deletingRecipeId, setDeletingRecipeId] = useState<string | null>(null)
  const [pendingDeleteRecipeId, setPendingDeleteRecipeId] = useState<string | null>(null)
  const feedbackTimerRef = useRef<number | null>(null)



  // 当加载或清空配方时同步更新输入框
  useEffect(() => {
    setRecipeFileName(loadedRecipeName ?? '')
  }, [loadedRecipeName])

  useEffect(() => {
    if (selectedRecipeId && !savedRecipes.some((recipe) => recipe.id === selectedRecipeId)) {
      setSelectedRecipeId('')
    }

    if (pendingDeleteRecipeId && !savedRecipes.some((recipe) => recipe.id === pendingDeleteRecipeId)) {
      setPendingDeleteRecipeId(null)
    }
  }, [pendingDeleteRecipeId, savedRecipes, selectedRecipeId])

  useEffect(() => {
    if (pendingDeleteRecipeId && pendingDeleteRecipeId !== selectedRecipeId) {
      setPendingDeleteRecipeId(null)
    }
  }, [pendingDeleteRecipeId, selectedRecipeId])


  // 显示反馈消息
  const showFeedback = (
    message: string,
    options?: { tone?: FeedbackTone; issueRows?: SyncIssueRow[]; durationMs?: number },
  ) => {
    const tone = options?.tone ?? 'success'
    const issueRows = options?.issueRows ?? []
    const durationMs = options?.durationMs ?? (issueRows.length > 0 ? 15000 : 3000)

    setFeedbackMessage(message)
    setFeedbackTone(tone)
    setSyncIssueRows(issueRows)

    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current)
    }

    feedbackTimerRef.current = window.setTimeout(() => {
      setFeedbackMessage('')
      setSyncIssueRows([])
      feedbackTimerRef.current = null
    }, durationMs)
  }

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current)
      }
    }
  }, [])

  const handleNewRecipe = () => {
    setRecipeFileName('')
    setSelectedRecipeId('')
    setPendingDeleteRecipeId(null)
    showFeedback('已新建配方')
  }

  const handleLoadRecipe = async () => {
    if (selectedRecipeId) {
      setPendingDeleteRecipeId(null)
      const succeeded = await onLoadRecipe(selectedRecipeId)
      const recipe = savedRecipes.find(r => r.id === selectedRecipeId)
      if (succeeded && recipe) {
        showFeedback(`已加载配方: ${recipe.name}`)
      }
    }
  }

  const handleDeleteRecipe = async () => {
    if (!selectedRecipeId) {
      return
    }

    if (pendingDeleteRecipeId !== selectedRecipeId) {
      setPendingDeleteRecipeId(selectedRecipeId)
      showFeedback('再次点击“删除”以确认')
      return
    }

    const recipe = savedRecipes.find(r => r.id === selectedRecipeId)
    const shouldClearRecipeName = Boolean(recipe && recipeFileName.trim() === recipe.name)

    try {
      setDeletingRecipeId(selectedRecipeId)
      setPendingDeleteRecipeId(null)
      const succeeded = await onDeleteRecipe(selectedRecipeId)
      if (!succeeded) {
        return
      }

      setSelectedRecipeId('')

      if (shouldClearRecipeName) {
        setRecipeFileName('')
      }

      if (recipe) {
        showFeedback(`已删除配方: ${recipe.name}`)
      }
    } finally {
      setDeletingRecipeId(null)
    }
  }





  useEffect(() => {
    if (shouldShowDcHoldingPowerOff) return
    if (!dcHoldingPowerOffTag?.allowWrite) return
    if (savingTagId === dcHoldingPowerOffTag.id) return
    if (!snapshots.has(dcHoldingPowerOffTag.id)) return

    const currentValue = getSnapshotRawValue(getSnapshotOrSimulated(dcHoldingPowerOffTag, 'dcHoldingPowerOff', snapshots))

    if (currentValue === '0') return

    onWrite(dcHoldingPowerOffTag.id, '0')
  }, [dcHoldingPowerOffTag, onWrite, savingTagId, shouldShowDcHoldingPowerOff, snapshots])

  const rows = useMemo(() => {
    const fieldRows = sourceTags

      .map((tag) => {
        const fieldKey = extractFieldKey(tag)
        if (!fieldKey) return null
        if (DJ_HIDDEN_FIELDS.has(fieldKey.toLowerCase())) return null
        if (fieldKey.toLowerCase() === 'dcholdingpoweroff' && !shouldShowDcHoldingPowerOff) return null

        const snapshot = getSnapshotOrSimulated(tag, fieldKey, snapshots)
        const meta = getFieldMeta(fieldKey)

        return {
          tag,
          fieldKey,
          label: meta?.label ?? fieldKey,
          subLabel: tag.displayName?.trim() || fieldKey,
          group: meta?.group ?? inferGroup(fieldKey),
          unit: meta?.unit ?? inferUnit(fieldKey, tag.dataType),
          valueText: formatSnapshotValue(fieldKey, tag, snapshot),
          updatedText: formatTimestamp(snapshot),
        } satisfies RecipeRow
      })
      .filter((row): row is RecipeRow => row !== null)

    return fieldRows.sort(compareRows)
  }, [shouldShowDcHoldingPowerOff, snapshots, sourceTags])




  const indexedRows = useMemo<IndexedRecipeRow[]>(
    () => rows.map((row, index) => ({ ...row, seq: index + 1 })),
    [rows],
  )

  const groupedRows = useMemo(
    () =>
      RECIPE_CARD_GROUPS.map((group) => ({
        group,
        rows: indexedRows.filter((row) => row.group === group),
      })),
    [indexedRows],
  )

  // 保存配方函数（放在 rows 定义之后）
  const handleSaveRecipe = async () => {
    if (!recipeFileName.trim()) {
      showFeedback('请输入配方名')
      return
    }

    // 收集当前所有参数值
    const recipeData: Record<string, string> = {}
    rows.forEach((row) => {
      const snapshot = snapshots.get(row.tag.id)
      if (snapshot?.value !== undefined && snapshot?.value !== null) {
        recipeData[row.tag.id] = String(snapshot.value)
      }
    })

    const succeeded = await onSaveRecipe(recipeFileName.trim(), recipeData)
    if (succeeded) {
      showFeedback(`配方 "${recipeFileName.trim()}" 已保存`)
    }
  }

  if (rows.length === 0) {
    return (
      <div className="recipe-empty">
        <h4>暂无 RecipeDJ 配方标签</h4>
        <p>当前页面只显示 `Local` 分组内识别为 `RecipeDJ` 的标签。</p>
      </div>
    )
  }

  return (
    <div className="recipe-container">
      <div className="recipe-control-panel">
        <div className="recipe-sheet-head">
          <div className="recipe-sheet-head-main">
            <h3 className="recipe-sheet-title">配方创建</h3>
            <p className="recipe-sheet-subtitle">
              输入配方名，设置所有配方参数后保存配方
            </p>
          </div>
          <div className="recipe-sheet-actions">
            <input
              type="text"
              className="recipe-filename-input"
              placeholder="输入配方名"
              value={recipeFileName}
              onChange={(e) => {
                let value = e.target.value
                // 配方名：限制最大16字符，禁止中文
                value = value.replace(/[\u4e00-\u9fa5]/g, '')
                if (value.length > 16) {
                  value = value.slice(0, 16)
                }
                setRecipeFileName(value)
              }}
              maxLength={16}
              aria-label="配方名"
            />
            <button type="button" className="recipe-btn recipe-btn-new" onClick={handleNewRecipe}>
              新建
            </button>
            <button
              type="button"
              className="recipe-btn recipe-btn-save"
              onClick={handleSaveRecipe}
              disabled={!recipeFileName.trim()}
            >
              保存
            </button>
          </div>
        </div>

        {/* 配方管理区域 */}
        <div className="recipe-manager-bar">
          <div className="recipe-manager-title">配方管理</div>
          <div className="recipe-radio-group">
            {savedRecipes.length === 0 ? (
              <span className="recipe-no-saved">暂无保存的配方</span>
            ) : (
              savedRecipes.map((recipe) => (
                <label key={recipe.id} className="recipe-radio-label">
                  <input
                    type="radio"
                    name="dj-recipe"
                    value={recipe.id}
                    checked={selectedRecipeId === recipe.id}
                    onChange={(e) => setSelectedRecipeId(e.target.value)}
                    className="recipe-radio"
                  />
                  <span className="recipe-radio-text">{recipe.name}</span>
                </label>
              ))
            )}
          </div>
          <div className="recipe-manager-actions">
            <button
              type="button"
              className="recipe-btn recipe-btn-load"
              onClick={() => void handleLoadRecipe()}
              disabled={!selectedRecipeId}
            >
              加载
            </button>
            <button
              type="button"
              className="recipe-btn recipe-btn-delete"
              onClick={() => void handleDeleteRecipe()}
              disabled={!selectedRecipeId || deletingRecipeId === selectedRecipeId}
            >
              {deletingRecipeId === selectedRecipeId ? '删除中...' : pendingDeleteRecipeId === selectedRecipeId ? '确认删除' : '删除'}
            </button>
          </div>
        </div>


      </div>

      {/* 反馈消息框 */}
      {feedbackMessage && (
        <div className={`recipe-feedback recipe-feedback-${feedbackTone}`}>
          <div className="recipe-feedback-message">{feedbackMessage}</div>
          {syncIssueRows.length > 0 ? (
            <div className="recipe-feedback-issues">
              <table className="recipe-feedback-table">
                <thead>
                  <tr>
                    <th>Target</th>
                    <th>Source</th>
                    <th>Value</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {syncIssueRows.slice(0, 30).map((item, index) => (
                    <tr key={`${item.target}-${item.source}-${index}`}>
                      <td title={item.target}>{item.target}</td>
                      <td title={item.source}>{item.source}</td>
                      <td>{item.value}</td>
                      <td>{item.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {syncIssueRows.length > 30 ? (
                <div className="recipe-feedback-truncated">Only first 30 issue rows are shown.</div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <div className="recipe-cards-grid">



        {groupedRows.map((groupBlock) => (
          <section key={groupBlock.group} className="recipe-group-card">
            <header className="recipe-group-card-head">
              <h4 className="recipe-group-card-title">{groupBlock.group}</h4>
            </header>

            <div className="recipe-table-wrap">
              <table className="recipe-table">
                <tbody>

                  {groupBlock.rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="recipe-card-empty-cell">暂无参数</td>
                    </tr>
                  ) : (
                    groupBlock.rows.map((row) => (
                      <tr key={row.tag.id}>
                        <td className="recipe-index-cell">{row.seq}</td>
                        <td>
                          <div className="recipe-parameter-cell">
                            <strong>{row.label}</strong>
                          </div>
                        </td>
                        <td className="recipe-variable-cell" title={row.tag.displayName}>{row.subLabel}</td>
                        <td className="recipe-value-cell">
                          <ValueEditor tag={row.tag} fieldKey={row.fieldKey} valueText={row.valueText} onWrite={onWrite} savingTagId={savingTagId} />
                        </td>
                        <td className="recipe-unit-cell">{row.unit || '—'}</td>
                        <td className="recipe-time-cell">{row.updatedText}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      {/* 配方同步区域 */}
      {(() => {
        const getExactTag = (tags: TagDefinition[], pathValue: string) =>
          tags.find((tag) => {
            const candidates = [tag.displayName, tag.browseName, tag.nodeId]
            return candidates.some((raw) => normalizeTagPath(raw ?? '') === pathValue)
          }) ?? null

        const writeWithRetry = async (tagId: string, value: string) => {
          const tryWrite = () =>
            Promise.race<boolean>([
              onWrite(tagId, value),
              new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), SYNC_WRITE_TIMEOUT_MS)),
            ])

          const first = await tryWrite()
          if (first) return true
          await new Promise<void>((resolve) => window.setTimeout(resolve, 120))
          return tryWrite()
        }

        const syncTo = async (recipeIndex: 1 | 2) => {
          showFeedback(`开始同步到 Recipe_DB.DJRecipe[${recipeIndex}]...`, {
            tone: 'warning',
            durationMs: 4000,
          })

          let writeCount = 0
          let failedCount = 0
          let skippedCount = 0
          const issueRows: SyncIssueRow[] = []

          for (const item of DJ_SYNC_FIELDS) {
            const sourceTag = getExactTag(sourceTags, item.sourcePath)
            const targetPath = item.fieldKey === 'recipename'
              ? `Recipe_DB.RecipeName[${recipeIndex}]`
              : `Recipe_DB.DJRecipe[${recipeIndex}].${item.targetField}`
            const targetTag = getExactTag(allTags, targetPath)

            if (!sourceTag) {
              skippedCount += 1
              issueRows.push({ target: targetPath, source: item.sourcePath, value: '-', reason: 'Source tag not found' })
              continue
            }

            if (!targetTag) {
              skippedCount += 1
              issueRows.push({ target: targetPath, source: item.sourcePath, value: '-', reason: 'Target tag not found' })
              continue
            }

            if (!targetTag.allowWrite) {
              failedCount += 1
              issueRows.push({ target: targetPath, source: item.sourcePath, value: '-', reason: 'Target tag is read-only (allowWrite=false)' })
              continue
            }

            const snap = snapshots.get(sourceTag.id)
            if (!snap || snap.value === undefined || snap.value === null) {
              skippedCount += 1
              issueRows.push({ target: targetPath, source: item.sourcePath, value: '-', reason: 'Source snapshot missing' })
              continue
            }

            let sourceValue = getSnapshotRawValue(snap)
            if (item.fieldKey === 'nobarcodestart') {
              sourceValue = normalizeNoBarcodeStartValue(sourceValue)
              sourceValue = sourceValue === '78' || sourceValue === '89' ? sourceValue : '89'
            }

            if (sourceValue === '') {
              skippedCount += 1
              issueRows.push({ target: targetPath, source: item.sourcePath, value: '(empty)', reason: 'Source value is empty' })
              continue
            }

            const succeeded = await writeWithRetry(targetTag.id, sourceValue)
            if (succeeded) {
              writeCount += 1
              continue
            }

            failedCount += 1
            issueRows.push({ target: targetPath, source: item.sourcePath, value: sourceValue, reason: `Write failed or timeout(>${SYNC_WRITE_TIMEOUT_MS}ms)` })
          }

          if (writeCount === 0 && failedCount === 0) {
            showFeedback(`未找到可同步到 Recipe_DB.DJRecipe[${recipeIndex}] 的有效参数`, { tone: 'warning', issueRows })
            return
          }

          if (failedCount > 0) {
            showFeedback(`同步完成：成功 ${writeCount} 项，失败 ${failedCount} 项，跳过 ${skippedCount} 项`, { tone: 'error', issueRows })
            return
          }

          showFeedback(`已同步 ${writeCount} 个参数到 Recipe_DB.DJRecipe[${recipeIndex}]${skippedCount > 0 ? `，跳过 ${skippedCount} 项` : ''}`, {
            tone: skippedCount > 0 ? 'warning' : 'success',
            issueRows: skippedCount > 0 ? issueRows : [],
          })
        }

        return (
          <div className="recipe-sheet-head recipe-sync-card">
            <div className="recipe-sheet-head-main">
              <h3 className="recipe-sheet-title">配方同步</h3>
              <p className="recipe-sheet-subtitle">请核对参数，同步到测试工位</p>
            </div>
            <div className="recipe-sheet-actions">
              {showRecipe1SyncButton ? (
                <button type="button" className="recipe-btn recipe-btn-save" onClick={() => void syncTo(1)} disabled={disableRecipe1SyncButton}>
                  {recipe1SyncLabel || '同步到工位1 (DJRecipe[1])'}
                </button>
              ) : null}
              {showRecipe2SyncButton ? (
                <button type="button" className="recipe-btn recipe-btn-save" onClick={() => void syncTo(2)} disabled={disableRecipe2SyncButton}>
                  {recipe2SyncLabel || '同步到工位2 (DJRecipe[2])'}
                </button>
              ) : null}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

