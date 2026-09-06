import { useEffect, useMemo, useRef, useState } from 'react'
import type { TagDefinition, TagSnapshot } from '../types'
import './Recipe.css'

interface RecipeFile {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

type RecipeSyncTarget = {
  index: number
  visible: boolean
  disabled?: boolean
  label: string
}

interface RecipeQYJProps {
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
  recipeSyncTargets: RecipeSyncTarget[]
}

type DictionaryOption = {
  label: string
  value: string
}

type QYJField = {
  fieldKey: string
  sourcePath: string
  targetPaths: readonly [string, string]
  label: string
  group: string
  unit: string
  options?: readonly DictionaryOption[]
  readOnly?: boolean
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
  config: QYJField
}

type IndexedRecipeRow = RecipeRow & { seq: number }

type FeedbackTone = 'success' | 'warning' | 'error'

type SyncIssueRow = {
  target: string
  source: string
  value: string
  reason: string
}

const SYNC_WRITE_TIMEOUT_MS = 4000
const RECIPE_CARD_GROUPS = ['全局设置', '出厂测试', '耐久测试', '泵头性能'] as const

const NO_BARCODE_START_OPTIONS: readonly DictionaryOption[] = [
  { label: 'YES', value: '89' },
  { label: 'NO', value: '78' },
] as const

const MOTOR_DIR_OPTIONS: readonly DictionaryOption[] = [
  { label: '正转', value: '0' },
  { label: '反转', value: '1' },
] as const

const QYJ_FIELD_GROUP_ORDER: Record<string, number> = {
  '全局设置': 0,
  '出厂测试': 1,
  '耐久测试': 2,
  '泵头性能': 3,
}

const QYJ_FIELDS: readonly QYJField[] = [
  { fieldKey: 'recipeName', sourcePath: 'Local.RecipeName', targetPaths: ['Recipe_DB.RecipeName[1]', 'Recipe_DB.RecipeName[2]'], label: '型号', group: '全局设置', unit: '', readOnly: true },
  { fieldKey: 'AutoSpeed', sourcePath: 'Local.RecipeQYJ.AutoSpeed', targetPaths: ['Recipe_DB.QYJRecipe[1].AutoSpeed', 'Recipe_DB.QYJRecipe[2].AutoSpeed'], label: '额定转速', group: '全局设置', unit: 'rpm' },
  { fieldKey: 'motorDir', sourcePath: 'Local.RecipeQYJ.motorDir', targetPaths: ['Recipe_DB.QYJRecipe[1].motorDir', 'Recipe_DB.QYJRecipe[2].motorDir'], label: '电机方向', group: '全局设置', unit: '', options: MOTOR_DIR_OPTIONS },
  { fieldKey: 'barcodeLength', sourcePath: 'Local.RecipeQYJ.barcodeLength', targetPaths: ['Recipe_DB.QYJRecipe[1].barcodeLength', 'Recipe_DB.QYJRecipe[2].barcodeLength'], label: '条码长度', group: '全局设置', unit: '位' },
  { fieldKey: 'noBarcodeStart', sourcePath: 'Local.RecipeQYJ.noBarcodeStart', targetPaths: ['Recipe_DB.QYJRecipe[1].noBarcodeStart', 'Recipe_DB.QYJRecipe[2].noBarcodeStart'], label: '无条码启动', group: '全局设置', unit: '', options: NO_BARCODE_START_OPTIONS },
  { fieldKey: 'inletCleanTime', sourcePath: 'Local.RecipeQYJ.inletCleanTime', targetPaths: ['Recipe_DB.QYJRecipe[1].inletCleanTime', 'Recipe_DB.QYJRecipe[2].inletCleanTime'], label: '进水清理时间', group: '出厂测试', unit: '秒' },
  { fieldKey: 'triggerOnTime', sourcePath: 'Local.RecipeQYJ.triggerOnTime', targetPaths: ['Recipe_DB.QYJRecipe[1].triggerOnTime', 'Recipe_DB.QYJRecipe[2].triggerOnTime'], label: '开枪时间', group: '出厂测试', unit: '秒' },
  { fieldKey: 'triggerOffTime', sourcePath: 'Local.RecipeQYJ.triggerOffTime', targetPaths: ['Recipe_DB.QYJRecipe[1].triggerOffTime', 'Recipe_DB.QYJRecipe[2].triggerOffTime'], label: '关枪时间', group: '出厂测试', unit: '秒' },
  { fieldKey: 'triggerCount', sourcePath: 'Local.RecipeQYJ.triggerCount', targetPaths: ['Recipe_DB.QYJRecipe[1].triggerCount', 'Recipe_DB.QYJRecipe[2].triggerCount'], label: '开关枪次数', group: '出厂测试', unit: '次' },
  { fieldKey: 'siphonTime', sourcePath: 'Local.RecipeQYJ.siphonTime', targetPaths: ['Recipe_DB.QYJRecipe[1].siphonTime', 'Recipe_DB.QYJRecipe[2].siphonTime'], label: '虹吸时间', group: '出厂测试', unit: '秒' },
  { fieldKey: 'siphon', sourcePath: 'Local.RecipeQYJ.siphon', targetPaths: ['Recipe_DB.QYJRecipe[1].siphon', 'Recipe_DB.QYJRecipe[2].siphon'], label: '虹吸能力', group: '出厂测试', unit: 'KPa' },
  { fieldKey: 'pressureHoldTime', sourcePath: 'Local.RecipeQYJ.pressureHoldTime', targetPaths: ['Recipe_DB.QYJRecipe[1].pressureHoldTime', 'Recipe_DB.QYJRecipe[2].pressureHoldTime'], label: '保压时间', group: '出厂测试', unit: '秒' },
  { fieldKey: 'holdingPressureDrop', sourcePath: 'Local.RecipeQYJ.holdingPressureDrop', targetPaths: ['Recipe_DB.QYJRecipe[1].holdingPressureDrop', 'Recipe_DB.QYJRecipe[2].holdingPressureDrop'], label: '保压压降', group: '出厂测试', unit: 'MPa' },
  { fieldKey: 'blowTime', sourcePath: 'Local.RecipeQYJ.blowTime', targetPaths: ['Recipe_DB.QYJRecipe[1].blowTime', 'Recipe_DB.QYJRecipe[2].blowTime'], label: '吹气清理时间', group: '出厂测试', unit: '秒' },
  { fieldKey: 'enduranceTime', sourcePath: 'Local.RecipeQYJ.enduranceTime', targetPaths: ['Recipe_DB.QYJRecipe[1].enduranceTime', 'Recipe_DB.QYJRecipe[2].enduranceTime'], label: '耐久时间', group: '耐久测试', unit: '小时' },
  { fieldKey: 'enduranceTriggerOnTime', sourcePath: 'Local.RecipeQYJ.enduranceTriggerOnTime', targetPaths: ['Recipe_DB.QYJRecipe[1].enduranceTriggerOnTime', 'Recipe_DB.QYJRecipe[2].enduranceTriggerOnTime'], label: '耐久开枪时间', group: '耐久测试', unit: '秒' },
  { fieldKey: 'enduranceTriggerOffTime', sourcePath: 'Local.RecipeQYJ.enduranceTriggerOffTime', targetPaths: ['Recipe_DB.QYJRecipe[1].enduranceTriggerOffTime', 'Recipe_DB.QYJRecipe[2].enduranceTriggerOffTime'], label: '耐久关枪时间', group: '耐久测试', unit: '秒' },
  { fieldKey: 'pressureHoldingInterval', sourcePath: 'Local.RecipeQYJ.pressureHoldingInterval', targetPaths: ['Recipe_DB.QYJRecipe[1].pressureHoldingInterval', 'Recipe_DB.QYJRecipe[2].pressureHoldingInterval'], label: '保压间隔', group: '耐久测试', unit: '次' },
  { fieldKey: 'enduranceInletMonitor', sourcePath: 'Local.RecipeQYJ.enduranceInletMonitor', targetPaths: ['Recipe_DB.QYJRecipe[1].enduranceInletMonitor', 'Recipe_DB.QYJRecipe[2].enduranceInletMonitor'], label: '水压监控', group: '耐久测试', unit: 'Bar' },
  { fieldKey: 'dataUploadFrequency', sourcePath: 'Local.RecipeQYJ.dataUploadFrequency', targetPaths: ['Recipe_DB.QYJRecipe[1].dataUploadFrequency', 'Recipe_DB.QYJRecipe[2].dataUploadFrequency'], label: '保存频率', group: '耐久测试', unit: '分钟' },
  { fieldKey: 'pressureMin', sourcePath: 'Local.RecipeQYJ.pressureMin', targetPaths: ['Recipe_DB.QYJRecipe[1].pressureMin', 'Recipe_DB.QYJRecipe[2].pressureMin'], label: '工作压力下限', group: '泵头性能', unit: 'MPa' },
  { fieldKey: 'pressureMax', sourcePath: 'Local.RecipeQYJ.pressureMax', targetPaths: ['Recipe_DB.QYJRecipe[1].pressureMax', 'Recipe_DB.QYJRecipe[2].pressureMax'], label: '工作压力上限', group: '泵头性能', unit: 'MPa' },
  { fieldKey: 'holdingPressureMin', sourcePath: 'Local.RecipeQYJ.holdingPressureMin', targetPaths: ['Recipe_DB.QYJRecipe[1].holdingPressureMin', 'Recipe_DB.QYJRecipe[2].holdingPressureMin'], label: '保压压力下限', group: '泵头性能', unit: 'MPa' },
  { fieldKey: 'holdingPressureMax', sourcePath: 'Local.RecipeQYJ.holdingPressureMax', targetPaths: ['Recipe_DB.QYJRecipe[1].holdingPressureMax', 'Recipe_DB.QYJRecipe[2].holdingPressureMax'], label: '保压压力上限', group: '泵头性能', unit: 'MPa' },
  { fieldKey: 'flowMin', sourcePath: 'Local.RecipeQYJ.flowMin', targetPaths: ['Recipe_DB.QYJRecipe[1].flowMin', 'Recipe_DB.QYJRecipe[2].flowMin'], label: '流量下限', group: '泵头性能', unit: 'L/M' },
  { fieldKey: 'flowMax', sourcePath: 'Local.RecipeQYJ.flowMax', targetPaths: ['Recipe_DB.QYJRecipe[1].flowMax', 'Recipe_DB.QYJRecipe[2].flowMax'], label: '流量上限', group: '泵头性能', unit: 'L/M' },
] as const

function normalizeTagPath(rawValue: string) {
  const trimmed = rawValue.trim()
  const nodeIdIndex = trimmed.indexOf(';s=')
  return nodeIdIndex >= 0 ? trimmed.slice(nodeIdIndex + 3) : trimmed
}

function normalizeNumericText(rawValue: string) {
  const trimmed = rawValue.trim()
  const match = trimmed.match(/^([+-]?)(\d+)(\.\d+)?$/)
  if (!match) return trimmed
  const [, sign, integerPart, decimalPart = ''] = match
  const normalizedIntegerPart = integerPart.replace(/^0+(?=\d)/, '')
  return `${sign}${normalizedIntegerPart}${decimalPart}`
}

function findTagByExactPath(tags: TagDefinition[], exactPath: string) {
  const normalizedExactPath = normalizeTagPath(exactPath).toLowerCase()
  return tags.find((tag) => {
    const candidates = [tag.displayName, tag.browseName, tag.nodeId]
    return candidates.some((raw) => normalizeTagPath(raw ?? '').toLowerCase() === normalizedExactPath)
  }) ?? null
}

function getSnapshotRawValue(snapshot: TagSnapshot | undefined) {
  if (snapshot?.value === null || snapshot?.value === undefined || snapshot.value === '') return ''
  if (typeof snapshot.value === 'boolean') return snapshot.value ? '1' : '0'
  return normalizeNumericText(String(snapshot.value))
}

function formatTimestamp(snapshot: TagSnapshot | undefined) {
  if (!snapshot?.sourceTimestamp) return '-'
  const date = new Date(snapshot.sourceTimestamp)
  if (Number.isNaN(date.getTime())) return '-'
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`
}

function getFieldConfig(fieldKey: string) {
  return QYJ_FIELDS.find((item) => item.fieldKey.toLowerCase() === fieldKey.toLowerCase())
}

function getFieldOptions(fieldKey: string) {
  return getFieldConfig(fieldKey)?.options ?? null
}

function formatSnapshotValue(fieldKey: string, tag: TagDefinition, snapshot: TagSnapshot | undefined) {
  const options = getFieldOptions(fieldKey)
  if (options) {
    const rawValue = snapshot?.value === null || snapshot?.value === undefined || snapshot.value === ''
      ? options[0].value
      : normalizeNumericText(String(snapshot.value))
    return options.find((item) => item.value === rawValue)?.label ?? rawValue
  }

  if (snapshot?.value === null || snapshot?.value === undefined || snapshot.value === '') return '-'
  if (typeof snapshot.value === 'number') {
    if (/float|double|single|decimal/i.test(tag.dataType)) return snapshot.value.toFixed(2)
    return String(snapshot.value)
  }
  if (typeof snapshot.value === 'boolean') return snapshot.value ? 'True' : 'False'
  return fieldKey.toLowerCase() === 'recipename' ? String(snapshot.value).trim() : normalizeNumericText(String(snapshot.value))
}

function getSimulatedFieldValue(fieldKey: string) {
  const key = fieldKey.toLowerCase()
  switch (key) {
    case 'recipename': return 'SIM-QYJ-001'
    case 'motordir': return '0'
    case 'nobarcodestart': return '89'
    case 'autospeed': return '2850'
    default:
      if (key.includes('flow')) return key.includes('max') ? '8.20' : '6.10'
      if (key.includes('pressure') || key.includes('drop')) return key.includes('max') ? '13.20' : '8.10'
      if (key.includes('time')) return '28'
      if (key.includes('count') || key.includes('interval')) return '10'
      if (key.includes('frequency')) return '5'
      if (key.includes('barcode')) return '16'
      return '1'
  }
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

function compareRows(left: RecipeRow, right: RecipeRow) {
  const groupWeight = (QYJ_FIELD_GROUP_ORDER[left.group] ?? 99) - (QYJ_FIELD_GROUP_ORDER[right.group] ?? 99)
  if (groupWeight !== 0) return groupWeight
  const leftIndex = QYJ_FIELDS.findIndex((item) => item.fieldKey === left.fieldKey)
  const rightIndex = QYJ_FIELDS.findIndex((item) => item.fieldKey === right.fieldKey)
  const safeLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex
  const safeRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex
  if (safeLeft !== safeRight) return safeLeft - safeRight
  return left.fieldKey.localeCompare(right.fieldKey, 'en-US', { numeric: true, sensitivity: 'base' })
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
  const config = getFieldConfig(fieldKey)
  const options = config?.options ?? null
  const currentValue = options ? (options.find((item) => item.label === valueText)?.value ?? valueText) : valueText === '-' ? '' : valueText
  const [draft, setDraft] = useState(currentValue)

  useEffect(() => {
    setDraft(currentValue)
  }, [currentValue, tag.id])

  if (config?.readOnly) return <span className="recipe-readonly recipe-readonly-value">{valueText}</span>
  if (!tag.allowWrite) return <span className="recipe-readonly recipe-readonly-value">{valueText}</span>

  const disabled = savingTagId === tag.id
  const commit = () => {
    const nextValue = normalizeNumericText(draft)
    if (nextValue !== draft) setDraft(nextValue)
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
            aria-label={`Toggle ${tag.displayName}`}
            onClick={() => {
              if (disabled || nextOption.value === currentValue) return
              setDraft(nextOption.value)
              onWrite(tag.id, nextOption.value)
            }}
          >
            {currentOption.label}
          </button>
          {disabled ? <span className="recipe-editor-status">Saving</span> : null}
        </div>
      )
    }

    return (
      <div className="recipe-editor recipe-editor-inline">
        <select
          className="recipe-editor-input recipe-editor-select"
          value={draft}
          disabled={disabled}
          aria-label={`Toggle ${tag.displayName}`}
          onChange={(event) => {
            const nextValue = event.target.value
            setDraft(nextValue)
            if (disabled || nextValue === currentValue) return
            onWrite(tag.id, nextValue)
          }}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {disabled ? <span className="recipe-editor-status">Saving</span> : null}
      </div>
    )
  }

  const isIntegerType = /int|integer|long|short|byte/i.test(tag.dataType)
  const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    let value = event.target.value
    if (isIntegerType) {
      value = value.replace(/[^\d-]/g, '')
      const parts = value.split('-')
      if (parts.length > 1) value = (parts[0] ? '' : '-') + parts.join('').replace(/-/g, '')
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
        aria-label={`Edit ${tag.displayName}`}
        placeholder="直接输入，回车或失焦保存"
      />
      {disabled ? <span className="recipe-editor-status">Saving</span> : null}
    </div>
  )
}

export function RecipeQYJ({
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
  recipeSyncTargets,
}: RecipeQYJProps) {
  const [recipeFileName, setRecipeFileName] = useState('')
  const [selectedRecipeId, setSelectedRecipeId] = useState('')
  const [feedbackMessage, setFeedbackMessage] = useState('')
  const [feedbackTone, setFeedbackTone] = useState<FeedbackTone>('success')
  const [syncIssueRows, setSyncIssueRows] = useState<SyncIssueRow[]>([])
  const [deletingRecipeId, setDeletingRecipeId] = useState<string | null>(null)
  const [pendingDeleteRecipeId, setPendingDeleteRecipeId] = useState<string | null>(null)
  const feedbackTimerRef = useRef<number | null>(null)

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

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current)
      }
    }
  }, [])

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

  const handleNewRecipe = () => {
    setRecipeFileName('')
    setSelectedRecipeId('')
    setPendingDeleteRecipeId(null)
    showFeedback('已新建配方')
  }

  const handleLoadRecipe = async () => {
    if (!selectedRecipeId) return
    setPendingDeleteRecipeId(null)
    const succeeded = await onLoadRecipe(selectedRecipeId)
    const recipe = savedRecipes.find((item) => item.id === selectedRecipeId)
    if (succeeded && recipe) {
        showFeedback(`已加载配方：${recipe.name}`)
    }
  }

  const handleDeleteRecipe = async () => {
    if (!selectedRecipeId) return

    if (pendingDeleteRecipeId !== selectedRecipeId) {
      setPendingDeleteRecipeId(selectedRecipeId)
      showFeedback('再次点击“删除”以确认')
      return
    }

    const recipe = savedRecipes.find((item) => item.id === selectedRecipeId)
    const shouldClearRecipeName = Boolean(recipe && recipeFileName.trim() === recipe.name)

    try {
      setDeletingRecipeId(selectedRecipeId)
      setPendingDeleteRecipeId(null)
      const succeeded = await onDeleteRecipe(selectedRecipeId)
      if (!succeeded) return
      setSelectedRecipeId('')
      if (shouldClearRecipeName) setRecipeFileName('')
      if (recipe) showFeedback(`已删除配方：${recipe.name}`)
    } finally {
      setDeletingRecipeId(null)
    }
  }

  const rows = useMemo(() => {
    const fieldRows = QYJ_FIELDS
      .map((config) => {
        const tag = findTagByExactPath(sourceTags, config.sourcePath)
        if (!tag) return null
        const snapshot = getSnapshotOrSimulated(tag, config.fieldKey, snapshots)
        return {
          tag,
          config,
          fieldKey: config.fieldKey,
          label: config.label,
          subLabel: tag.displayName?.trim() || config.fieldKey,
          group: config.group,
          unit: config.unit,
          valueText: formatSnapshotValue(config.fieldKey, tag, snapshot),
          updatedText: formatTimestamp(snapshot),
        } satisfies RecipeRow
      })
      .filter((row): row is RecipeRow => row !== null)

    return fieldRows.sort(compareRows)
  }, [snapshots, sourceTags])

  const indexedRows = useMemo<IndexedRecipeRow[]>(() => rows.map((row, index) => ({ ...row, seq: index + 1 })), [rows])

  const groupedRows = useMemo(
    () => RECIPE_CARD_GROUPS.map((group) => ({ group, rows: indexedRows.filter((row) => row.group === group) })),
    [indexedRows],
  )

  const handleSaveRecipe = async () => {
    if (!recipeFileName.trim()) {
      showFeedback('请输入配方名称')
      return
    }

    const recipeData: Record<string, string> = {}
    rows.forEach((row) => {
      const snapshot = snapshots.get(row.tag.id)
      if (snapshot?.value !== undefined && snapshot?.value !== null) {
        recipeData[row.tag.id] = String(snapshot.value)
      }
    })

    const succeeded = await onSaveRecipe(recipeFileName.trim(), recipeData)
    if (succeeded) {
      showFeedback(`已保存配方：${recipeFileName.trim()}`)
    }
  }

  if (rows.length === 0) {
    return (
      <div className="recipe-empty">
        <h4>未找到 QYJ 配方标签</h4>
        <p>请确认 Local.RecipeQYJ 标签已导入并启用。</p>
      </div>
    )
  }

  return (
    <div className="recipe-container">
      <div className="recipe-control-panel">
        <div className="recipe-sheet-head">
          <div className="recipe-sheet-head-main">
            <h3 className="recipe-sheet-title">配方创建</h3>
            <p className="recipe-sheet-subtitle">输入配方名，设置所有配方参数后保存配方</p>
          </div>
          <div className="recipe-sheet-actions">
            <input
              type="text"
              className="recipe-filename-input"
              placeholder="配方名称"
              value={recipeFileName}
              onChange={(e) => {
                let value = e.target.value.replace(/[^\x20-\x7E]/g, '')
                if (value.length > 16) value = value.slice(0, 16)
                setRecipeFileName(value)
              }}
              maxLength={16}
              aria-label="配方名称"
            />
            <button type="button" className="recipe-btn recipe-btn-new" onClick={handleNewRecipe}>新建</button>
            <button type="button" className="recipe-btn recipe-btn-save" onClick={handleSaveRecipe} disabled={!recipeFileName.trim()}>保存</button>
          </div>
        </div>

        <div className="recipe-manager-bar">
          <div className="recipe-manager-title">配方管理</div>
          <div className="recipe-radio-group">
            {savedRecipes.length === 0 ? (
              <span className="recipe-no-saved">暂无已保存配方</span>
            ) : (
              savedRecipes.map((recipe) => (
                <label key={recipe.id} className="recipe-radio-label">
                  <input
                    type="radio"
                    name="qyj-recipe"
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
            <button type="button" className="recipe-btn recipe-btn-load" onClick={() => void handleLoadRecipe()} disabled={!selectedRecipeId}>加载</button>
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

      {feedbackMessage ? (
        <div className={`recipe-feedback recipe-feedback-${feedbackTone}`}>
          <div className="recipe-feedback-message">{feedbackMessage}</div>
          {syncIssueRows.length > 0 ? (
            <div className="recipe-feedback-issues">
              <table className="recipe-feedback-table">
                <thead>
                  <tr>
                    <th>目标</th>
                    <th>源</th>
                    <th>值</th>
                    <th>原因</th>
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
      ) : null}

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
                        <td><div className="recipe-parameter-cell"><strong>{row.label}</strong></div></td>
                        <td className="recipe-variable-cell" title={row.tag.displayName}>{row.subLabel}</td>
                        <td className="recipe-value-cell">
                          <ValueEditor tag={row.tag} fieldKey={row.fieldKey} valueText={row.valueText} onWrite={onWrite} savingTagId={savingTagId} />
                        </td>
                        <td className="recipe-unit-cell">{row.unit || '-'}</td>
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

      {(() => {
      const syncTo = async (recipeIndex: number) => {
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

          let writeCount = 0
          let failedCount = 0
          let skippedCount = 0
          const issueRows: SyncIssueRow[] = []

          for (const item of QYJ_FIELDS) {
            const sourceTag = findTagByExactPath(sourceTags, item.sourcePath)
            const targetPath = item.fieldKey === 'recipeName'
              ? `Recipe_DB.RecipeName[${recipeIndex}]`
              : `Recipe_DB.QYJRecipe[${recipeIndex}].${item.fieldKey}`
            const targetTag = findTagByExactPath(allTags, targetPath)

            if (!sourceTag) {
              skippedCount += 1
              issueRows.push({
                target: targetPath,
                source: item.sourcePath,
                value: '-',
                reason: 'Source tag not found',
              })
              continue
            }
            if (!targetTag) {
              skippedCount += 1
              issueRows.push({
                target: targetPath,
                source: item.sourcePath,
                value: '-',
                reason: 'Target tag not found',
              })
              continue
            }
            if (!targetTag.allowWrite) {
              failedCount += 1
              issueRows.push({
                target: targetPath,
                source: item.sourcePath,
                value: '-',
                reason: 'Target tag is read-only (allowWrite=false)',
              })
              continue
            }

            const snapshot = snapshots.get(sourceTag.id)
            if (!snapshot || snapshot.value === undefined || snapshot.value === null) {
              skippedCount += 1
              issueRows.push({
                target: targetPath,
                source: item.sourcePath,
                value: '-',
                reason: 'Source snapshot missing',
              })
              continue
            }

            const sourceValue = item.options ? getFieldConfig(item.fieldKey)?.options?.find((opt) => opt.label === formatSnapshotValue(item.fieldKey, sourceTag, snapshot))?.value ?? formatSnapshotValue(item.fieldKey, sourceTag, snapshot) : getSnapshotRawValue(snapshot)
            if (sourceValue === '') {
              skippedCount += 1
              issueRows.push({
                target: targetPath,
                source: item.sourcePath,
                value: '(empty)',
                reason: 'Source value is empty',
              })
              continue
            }

            const succeeded = await writeWithRetry(targetTag.id, sourceValue)
            if (succeeded) {
              writeCount += 1
              continue
            }

            failedCount += 1
            issueRows.push({
              target: targetPath,
              source: item.sourcePath,
              value: sourceValue,
              reason: `Write failed or timeout(>${SYNC_WRITE_TIMEOUT_MS}ms)`,
            })
          }

          if (writeCount === 0 && failedCount === 0) {
            showFeedback(`未找到可同步到 Recipe_DB.QYJRecipe[${recipeIndex}] 的有效参数`, { tone: 'warning', issueRows })
            return
          }

          if (failedCount > 0) {
            showFeedback(`同步完成：成功 ${writeCount}，失败 ${failedCount}，跳过 ${skippedCount}`, { tone: 'error', issueRows })
            return
          }

          showFeedback(`已同步 ${writeCount} 个值到 Recipe_DB.QYJRecipe[${recipeIndex}]${skippedCount > 0 ? `，跳过 ${skippedCount}` : ''}`, {
            tone: skippedCount > 0 ? 'warning' : 'success',
            issueRows: skippedCount > 0 ? issueRows : [],
          })
        }

        return (
          <div className="recipe-sheet-head recipe-sync-card">
            <div className="recipe-sheet-head-main">
              <h3 className="recipe-sheet-title">配方同步</h3>
              <p className="recipe-sheet-subtitle">同步前请确认当前配方参数。</p>
            </div>
            <div className="recipe-sheet-actions">
              {recipeSyncTargets.filter((target) => target.visible).map((target) => (
                <button
                  key={target.index}
                  type="button"
                  className="recipe-btn recipe-btn-save"
                  onClick={() => void syncTo(target.index)}
                  disabled={target.disabled}
                >
                  {`同步到${target.label || `工位${target.index}`}`}
                </button>
              ))}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
