import { useEffect, useMemo, useState } from 'react'
import type { TagDefinition, TagSnapshot } from '../types'
import './Recipe.css'


interface RecipeFile {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

interface RecipeQYJProps {
  tags: TagDefinition[]
  snapshots: Map<string, TagSnapshot>
  onWrite: (tagId: string, value: string) => void
  savingTagId: string | null
  savedRecipes: RecipeFile[]
  onSaveRecipe: (recipeName: string, recipeData: Record<string, string>) => Promise<boolean>
  onLoadRecipe: (recipeId: string) => Promise<boolean>
  onDeleteRecipe: (recipeId: string) => Promise<boolean>
  loadedRecipeName?: string
  showRecipe1SyncButton: boolean
  showRecipe2SyncButton: boolean
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
  inletcleantime: { label: '进水扫膛时间', unit: '秒', group: '出厂测试' },
  pressuremin: { label: '工作压力下限', unit: 'MPa', group: '泵头性能' },
  pressuremax: { label: '工作压力上限', unit: 'MPa', group: '泵头性能' },
  pressureholdtime: { label: '保压时间', unit: '秒', group: '出厂测试' },
  pressureholdinginterval: { label: '保压间隔', unit: '次', group: '耐久测试' },
  triggerontime: { label: '开枪时间', unit: '秒', group: '出厂测试' },
  triggerofftime: { label: '关枪时间', unit: '秒', group: '出厂测试' },
  triggercount: { label: '开关枪次数', unit: '次', group: '出厂测试' },
  siphon: { label: '虹吸能力', unit: 'KPa', group: '出厂测试' },
  siphontime: { label: '虹吸时间', unit: '秒', group: '出厂测试' },
  blowtime: { label: '吹气清理时间', unit: '秒', group: '出厂测试' },
  endurancetime: { label: '耐久时间', unit: '小时', group: '耐久测试' },
  endurancetriggerontime: { label: '耐久开枪时间', unit: '秒', group: '耐久测试' },
  endurancetriggerofftime: { label: '耐久关枪时间', unit: '秒', group: '耐久测试' },
  enduranceinletmonitor: { label: '水压监控', unit: 'Bar', group: '耐久测试' },
  datauploadfrequency: { label: '保存频率', unit: '分钟', group: '耐久测试' },
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
  if (key.includes('time')) return '秒'
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

function resolveDictionaryValue(fieldKey: string, valueText: string) {
  const options = getFieldOptions(fieldKey)
  if (!options) return valueText

  const normalized = normalizeNumericText(valueText)
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
      : normalizeNumericText(String(snapshot.value))
    return options.find((item) => item.value === rawValue)?.label ?? rawValue
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
    const nextValue = fieldKey.toLowerCase() === 'recipename' ? draft.trim() : normalizeNumericText(draft)
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

export function RecipeQYJ({
  tags,
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
  recipe1SyncLabel,
  recipe2SyncLabel,
}: RecipeQYJProps) {
  // 配方名称输入框状态（独立于型号标签）
  const [recipeFileName, setRecipeFileName] = useState('')

  // 选中的配方ID
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>('')

  // 反馈消息状态
  const [feedbackMessage, setFeedbackMessage] = useState<string>('')
  const [deletingRecipeId, setDeletingRecipeId] = useState<string | null>(null)
  const [pendingDeleteRecipeId, setPendingDeleteRecipeId] = useState<string | null>(null)



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

  const showFeedback = (message: string) => {
    setFeedbackMessage(message)
    setTimeout(() => setFeedbackMessage(''), 3000)
  }

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

    return fieldRows.sort(compareRows)
  }, [snapshots, tags])



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
        <h4>暂无 RecipeQYJ 配方标签</h4>
        <p>当前页面只显示 `Local` 分组内识别为 `RecipeQYJ` 的标签。</p>
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
              onChange={(e) => setRecipeFileName(e.target.value)}
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
        <div className="recipe-feedback">
          {feedbackMessage}
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

      {(() => {
        const hasAnySyncButton = showRecipe1SyncButton || showRecipe2SyncButton

        const getTargetFieldKey = (tag: TagDefinition): string | null => {
          const candidates = [tag.displayName, tag.browseName, tag.nodeId]
          const patterns = [
            /^Device1[._]Recipe1\.?(.+)$/i,
            /^Device1[._]Recipe2\.?(.+)$/i,
            /^Device1_Recipe1(?:\[\d+\])?_(.+)$/i,
            /^Device1_Recipe2(?:\[\d+\])?_(.+)$/i,
          ] as const
          for (const raw of candidates) {
            const v = (raw ?? '').trim()
            if (!v) continue
            for (const p of patterns) {
              const m = v.match(p)
              if (m) return m[1].trim().replace(/^_+/, '')
            }
          }
          return null
        }

        const syncTo = async (groupKey: 'Device1_Recipe1' | 'Device1_Recipe2') => {
          const valueByField: Record<string, string> = {}
          rows.forEach((r) => {
            const snap = getSnapshotOrSimulated(r.tag, r.fieldKey, snapshots)
            const raw = getSnapshotRawValue(snap)
            if (raw !== '') valueByField[r.fieldKey.toLowerCase()] = raw
          })

          const targets = tags.filter(t => (t.groupKey ?? '').toLowerCase() === groupKey.toLowerCase())
          let writeCount = 0
          for (const t of targets) {
            const k = getTargetFieldKey(t)
            if (!k) continue
            const v = valueByField[k.toLowerCase()]
            if (v === undefined) continue
            onWrite(t.id, v)
            writeCount += 1
          }
          showFeedback(`已同步 ${writeCount} 个参数到 ${groupKey}`)
        }

        return (
          <div className="recipe-sheet-head recipe-sync-card">
            <div className="recipe-sheet-head-main">
              <h3 className="recipe-sheet-title">配方同步</h3>
              <p className="recipe-sheet-subtitle">请核对参数,同步到测试工位</p>
            </div>
            {hasAnySyncButton ? (
              <div className="recipe-sheet-actions">
                {showRecipe1SyncButton ? (
                  <button type="button" className="recipe-btn recipe-btn-save" onClick={() => void syncTo('Device1_Recipe1')}>
                    {`同步到${recipe1SyncLabel}`}
                  </button>
                ) : null}
                {showRecipe2SyncButton ? (
                  <button type="button" className="recipe-btn recipe-btn-save" onClick={() => void syncTo('Device1_Recipe2')}>
                    {`同步到${recipe2SyncLabel}`}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })()}
    </div>
  )
}

