import { useEffect, useMemo, useState } from 'react'
import type { TagDefinition, TagSnapshot } from '../types'
import './Recipe.css'

interface RecipeQYJProps {
  tags: TagDefinition[]
  recipeNameTag?: TagDefinition | null
  snapshots: Map<string, TagSnapshot>
  onWrite: (tagId: string, value: string) => void
  savingTagId: string | null
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

const RECIPE_CARD_GROUPS = ['全局设置', '出厂测试', '耐久测试', '泵头性能'] as const

function getSimulatedFieldValue(fieldKey: string) {
  const key = fieldKey.toLowerCase()
  if (key === 'recipename') return 'SIM-QYJ-001'
  if (key === 'motordir') return '0'
  if (key === 'nobarcodestart') return '89'
  if (key === 'autospeed') return '2850'
  if (key.includes('flow')) return key.includes('max') ? '8.20' : '6.10'
  if (key.includes('pressure') || key.includes('drop')) return key.includes('max') ? '13.20' : '8.10'
  if (key.includes('current')) return key.includes('max') ? '11.80' : '7.20'
  if (key.includes('time')) return '28'
  if (key.includes('count') || key.includes('interval')) return '10'
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

const QYJ_FIELD_ORDER = [

  'recipeName',
  'AutoSpeed',
  'motorDir',
  'barcodeLength',
  'noBarcodeStart',
  'inletCleanTime',
  'triggerOnTime',
  'triggerOffTime',
  'triggerCount',
  'siphonTime',
  'siphon',
  'pressureHoldTime',
  'holdingPressureDrop',
  'blowTime',
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
  'flowMin',
  'flowMax',
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

const MOTOR_DIR_OPTIONS: readonly DictionaryOption[] = [
  { label: '正转', value: '0' },
  { label: '反转', value: '1' },
] as const

const GROUP_WEIGHT: Record<string, number> = {
  '全局设置': 0,
  '出厂测试': 1,
  '耐久测试': 2,
  '泵头性能': 3,
  '其他参数': 4,
}

const QYJ_FIELD_META: Record<string, FieldMeta> = {
  recipename: { label: '型号', unit: '', group: '全局设置' },
  autospeed: { label: '额定转速', unit: 'rpm', group: '全局设置' },
  motordir: { label: '旋转方向', unit: '', group: '全局设置' },
  barcodelength: { label: '条码长度', unit: '位', group: '全局设置' },
  nobarcodestart: { label: '无条码启动', unit: '', group: '全局设置' },
  inletcleantime: { label: '进水扫膛时间', unit: 's', group: '出厂测试' },
  pressuremin: { label: '工作压力下限', unit: 'MPa', group: '泵头性能' },
  pressuremax: { label: '工作压力上限', unit: 'MPa', group: '泵头性能' },
  pressureholdtime: { label: '保压时间', unit: 's', group: '出厂测试' },
  pressureholdinginterval: { label: '保压间隔', unit: '次', group: '耐久测试' },
  triggerontime: { label: '开枪时间', unit: 's', group: '出厂测试' },
  triggerofftime: { label: '关枪时间', unit: 's', group: '出厂测试' },
  triggercount: { label: '开关枪次数', unit: '次', group: '出厂测试' },
  siphon: { label: '虹吸能力', unit: 'KPa', group: '出厂测试' },
  siphontime: { label: '虹吸时间', unit: 's', group: '出厂测试' },
  blowtime: { label: '吹气清理时间', unit: 's', group: '出厂测试' },
  endurancetime: { label: '耐久时间', unit: 'h', group: '耐久测试' },
  endurancetriggerontime: { label: '耐久开枪时间', unit: 's', group: '耐久测试' },
  endurancetriggerofftime: { label: '耐久关枪时间', unit: 's', group: '耐久测试' },
  enduranceinletmonitor: { label: '水压监控', unit: 'Bar', group: '耐久测试' },
  datauploadfrequency: { label: '保存频率', unit: 'Min', group: '耐久测试' },
  holdingpressuremin: { label: '保压压力下限', unit: 'MPa', group: '泵头性能' },
  holdingpressuremax: { label: '保压压力上限', unit: 'MPa', group: '泵头性能' },
  holdingpressuredrop: { label: '保压压降', unit: 'MPa', group: '出厂测试' },
  flowmin: { label: '流量下限', unit: 'L/M', group: '泵头性能' },
  flowmax: { label: '流量上限', unit: 'L/M', group: '泵头性能' },
}

const QYJ_FIELD_PATTERNS = [
  /^Local\.RecipeQYJ\.(.+)$/i,
  /^Local\.Recipe_DB\.(?:QYJRecipe|QYIRecipe)(?:\[\d+\])?\.(.+)$/i,
  /^Local\.Recipe_DB_(?:QYJRecipe|QYIRecipe)(?:\[\d+\])?_(.+)$/i,
  /^LocalVariable\.QYJRecipe\.(.+)$/i,
] as const

function extractFieldKey(tag: TagDefinition) {
  const candidates = [tag.displayName, tag.browseName, tag.nodeId]

  for (const rawValue of candidates) {
    const value = (rawValue ?? '').trim()
    if (!value) continue

    for (const pattern of QYJ_FIELD_PATTERNS) {
      const match = value.match(pattern)
      if (match) return match[1].trim().replace(/^_+/, '')
    }
  }

  return null
}

function getFieldMeta(fieldKey: string) {
  return QYJ_FIELD_META[fieldKey.toLowerCase()]
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
  if (key.includes('voltage')) return 'V'
  if (key.includes('frequency')) return 'Hz'
  if (key.includes('time')) return 's'
  if (key.includes('count') || key.includes('interval')) return '次'
  if (key.includes('barcodelength')) return '位'
  return ''
}

function getFieldOptions(fieldKey: string) {
  const key = fieldKey.toLowerCase()
  if (key === 'nobarcodestart') return NO_BARCODE_START_OPTIONS
  if (key === 'motordir') return MOTOR_DIR_OPTIONS
  return null
}

function resolveDictionaryValue(fieldKey: string, valueText: string) {
  const options = getFieldOptions(fieldKey)
  if (!options) return valueText

  const normalized = valueText.trim()
  if (!normalized || normalized === '—') return options[0].value

  const matchedByValue = options.find((item) => item.value === normalized)
  if (matchedByValue) return matchedByValue.value

  const matchedByLabel = options.find((item) => item.label.toLowerCase() === normalized.toLowerCase())
  return matchedByLabel?.value ?? options[0].value
}

function formatSnapshotValue(fieldKey: string, tag: TagDefinition, snapshot: TagSnapshot | undefined) {
  const options = getFieldOptions(fieldKey)
  if (options) {
    const rawValue = snapshot?.value === null || snapshot?.value === undefined || snapshot.value === ''
      ? options[0].value
      : String(snapshot.value).trim()
    return options.find((item) => item.value === rawValue)?.label ?? rawValue
  }

  if (snapshot?.value === null || snapshot?.value === undefined || snapshot.value === '') return '—'
  if (typeof snapshot.value === 'number') {
    if (/float|double|single|decimal/i.test(tag.dataType)) return snapshot.value.toFixed(2)
    return String(snapshot.value)
  }
  if (typeof snapshot.value === 'boolean') return snapshot.value ? 'True' : 'False'
  return String(snapshot.value)
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
  const groupWeight = (GROUP_WEIGHT[left.group] ?? 99) - (GROUP_WEIGHT[right.group] ?? 99)
  if (groupWeight !== 0) return groupWeight

  const leftIndex = QYJ_FIELD_ORDER.indexOf(left.fieldKey as (typeof QYJ_FIELD_ORDER)[number])
  const rightIndex = QYJ_FIELD_ORDER.indexOf(right.fieldKey as (typeof QYJ_FIELD_ORDER)[number])
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
  onWrite: (tagId: string, value: string) => void
  savingTagId: string | null
}) {
  const options = getFieldOptions(fieldKey)
  const currentValue = options ? resolveDictionaryValue(fieldKey, valueText) : valueText === '—' ? '' : valueText
  const [draft, setDraft] = useState(currentValue)

  useEffect(() => {
    setDraft(currentValue)
  }, [currentValue, tag.id])

  if (!tag.allowWrite) return <span className="recipe-readonly recipe-readonly-value">{valueText}</span>

  const disabled = savingTagId === tag.id
  const commit = () => {
    const nextValue = draft.trim()
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

  return (
    <div className="recipe-editor recipe-editor-inline">
      <input
        className="recipe-editor-input"
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
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

export function RecipeQYJ({ tags, recipeNameTag, snapshots, onWrite, savingTagId }: RecipeQYJProps) {
  const rows = useMemo(() => {
    const fieldRows = tags
      .map((tag) => {
        const fieldKey = extractFieldKey(tag)
        if (!fieldKey) return null

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

    const recipeNameRow = recipeNameTag
      ? ({
          tag: recipeNameTag,
          fieldKey: 'recipeName',
          label: '型号',
          subLabel: recipeNameTag.displayName?.trim() || 'Local.RecipeName',
          group: '全局设置',
          unit: '',
          valueText: formatSnapshotValue('recipeName', recipeNameTag, getSnapshotOrSimulated(recipeNameTag, 'recipeName', snapshots)),
          updatedText: formatTimestamp(getSnapshotOrSimulated(recipeNameTag, 'recipeName', snapshots)),

        } satisfies RecipeRow)
      : null

    return [...(recipeNameRow ? [recipeNameRow] : []), ...fieldRows].sort(compareRows)
  }, [recipeNameTag, snapshots, tags])

  const editableCount = rows.filter((row) => row.tag.allowWrite).length

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


  if (rows.length === 0) {
    return (
      <div className="recipe-empty">
        <h4>暂无 RecipeQYJ 配方标签</h4>
        <p>当前页面只显示 `Local` 分组内识别为 `RecipeQYJ` 的标签。</p>
      </div>
    )
  }

  return (
    <div className="recipe-container">
      <div className="recipe-sheet-head">
        <div className="recipe-sheet-head-main">
          <h3 className="recipe-sheet-title">当前值列支持直接修改，汽油机配方型号取自 `Local.RecipeName`。</h3>
          <p className="recipe-sheet-subtitle">
            参数总数 <strong>{rows.length}</strong> ｜ 可编辑参数 <strong>{editableCount}</strong>
          </p>
        </div>
      </div>

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
    </div>
  )
}

