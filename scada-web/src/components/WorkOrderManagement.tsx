import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  createWorkOrder,
  deleteWorkOrder,
  getRecipes,
  getTags,
  getWorkOrders,
  updateWorkOrder,
  updateWorkOrderStatus,
  writeTag,
} from '../api'
import type { TagDefinition, WorkOrder, WorkOrderStatus } from '../types'

type RecipeNameOption = { key: string; name: string; category: '电机泵' | '汽油机' }

interface WorkOrderManagementProps {
  onStatus: (message: string) => void
}

const todayText = new Date().toISOString().slice(0, 10)

const EMPTY_WORK_ORDER_FORM = {
  workOrderNo: '',
  productName: '未指定型号',
  planQty: 1,
  dueDate: todayText,
}

export function WorkOrderManagement({ onStatus }: WorkOrderManagementProps) {
  const [recipeOptions, setRecipeOptions] = useState<RecipeNameOption[]>([])
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([])
  const [loading, setLoading] = useState(false)
  const [workOrderDraft, setWorkOrderDraft] = useState(EMPTY_WORK_ORDER_FORM)
  const orderNoClearedRef = useRef(false)

  const archivedWorkOrders = useMemo(() => workOrders.filter((item) => item.status === '完工归档'), [workOrders])
  const activeWorkOrders = useMemo(() => workOrders.filter((item) => item.status !== '完工归档'), [workOrders])
  const sortedActiveWorkOrders = useMemo(() => [...activeWorkOrders].sort(sortWorkOrders), [activeWorkOrders])
  const sortedArchivedWorkOrders = useMemo(() => [...archivedWorkOrders].sort(sortWorkOrders), [archivedWorkOrders])

  const analysis = useMemo(() => {
    const runningWorkOrder = activeWorkOrders.find((item) => item.status === '执行中')
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const overdue = activeWorkOrders.filter((item) => new Date(item.dueDate) < today)

    return {
      runningPlanQty: runningWorkOrder?.planQty ?? 0,
      runningCompletedQty: runningWorkOrder?.completedQty ?? 0,
      overdue,
    }
  }, [activeWorkOrders])

  async function refreshData(successMessage?: string) {
    setLoading(true)
    try {
      const [recipes, nextWorkOrders] = await Promise.all([getRecipes(), getWorkOrders()])
      const djRecipes = recipes.filter((recipe) => recipe.recipeType === 'DJ')
      const qyjRecipes = recipes.filter((recipe) => recipe.recipeType === 'QYJ')
      const nextRecipeOptions: RecipeNameOption[] = [
        ...djRecipes.map((recipe) => ({ key: `DJRecipe:${recipe.id}`, name: recipe.name, category: '电机泵' as const })),
        ...qyjRecipes.map((recipe) => ({ key: `QYJRecipe:${recipe.id}`, name: recipe.name, category: '汽油机' as const })),
      ].filter((recipe) => recipe.name)
      setRecipeOptions(nextRecipeOptions)
      setWorkOrders(nextWorkOrders)
      setWorkOrderDraft((current) => current.productName ? current : { ...current, productName: '未指定型号' })
      if (shouldClearLocalOrderNoTags(nextWorkOrders)) {
        if (!orderNoClearedRef.current) {
          await clearLocalOrderNoTags()
          orderNoClearedRef.current = true
        }
      } else {
        orderNoClearedRef.current = false
      }
      if (successMessage) onStatus(successMessage)
    } catch (error) {
      onStatus(error instanceof Error ? error.message : '工单数据加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refreshData()

    const timer = window.setInterval(() => {
      void refreshData()
    }, 10_000)

    return () => window.clearInterval(timer)
  }, [])

  async function handleCreateWorkOrder(event: FormEvent) {
    event.preventDefault()
    const productName = workOrderDraft.productName.trim()
    if (!productName) {
      onStatus('产品名称不能为空')
      return
    }

    try {
      await createWorkOrder({
        workOrderNo: workOrderDraft.workOrderNo.trim() || null,
        productName,
        planQty: Number(workOrderDraft.planQty),
        priority: 1,
        dueDate: workOrderDraft.dueDate,
      })
      setWorkOrderDraft(EMPTY_WORK_ORDER_FORM)
      await refreshData('工单已创建')
    } catch (error) {
      onStatus(error instanceof Error ? error.message : '工单创建失败')
    }
  }

  async function handleStatusChange(workOrder: WorkOrder, status: WorkOrderStatus) {
    try {
      if (status === '执行中') {
        await syncWorkOrderNoToLocalOrderNoTags(workOrder)
      }
      await updateWorkOrderStatus(workOrder.id, status)
      await refreshData('工单状态已更新')
    } catch (error) {
      onStatus(error instanceof Error ? error.message : '工单状态更新失败')
    }
  }

  async function handleCompletedQtyChange(workOrder: WorkOrder, completedQty: number) {
    await handleSaveWorkOrder(workOrder, { completedQty })
  }

  async function handleSaveWorkOrder(workOrder: WorkOrder, patch: Partial<Pick<WorkOrder, 'completedQty' | 'dueDate' | 'status' | 'productName'>>) {
    try {
      await updateWorkOrder(workOrder.id, {
        productName: patch.productName ?? workOrder.productName,
        planQty: workOrder.planQty,
        completedQty: patch.completedQty ?? workOrder.completedQty,
        priority: workOrder.priority,
        status: patch.status ?? workOrder.status,
        dueDate: patch.dueDate ?? workOrder.dueDate,
      })
      await refreshData('工单已更新')
    } catch (error) {
      onStatus(error instanceof Error ? error.message : '工单更新失败')
    }
  }

  async function handleDeleteWorkOrder(workOrder: WorkOrder) {
    if (!window.confirm(`确定删除工单 "${workOrder.workOrderNo}" 吗？`)) return
    try {
      await deleteWorkOrder(workOrder.id)
      await refreshData('工单已删除')
    } catch (error) {
      onStatus(error instanceof Error ? error.message : '工单删除失败')
    }
  }

  return (
    <section className="page-shell work-order-page-shell">
      <ProductionHeader
        title="生产管理"
        subtitle="维护工单、排产、交付日期与报工进度"
        loading={loading}
        onRefresh={() => void refreshData('工单数据已刷新')}
      />
      <ProductionSummaryStrip
        products={recipeOptions.length}
        activeWorkOrders={activeWorkOrders.length}
        runningQty={analysis.runningCompletedQty}
        runningPlanQty={analysis.runningPlanQty}
        alarms={analysis.overdue.length}
      />
      <div className="product-layout work-order-page-content">
        <form className="edit-panel product-form-panel" onSubmit={handleCreateWorkOrder}>
            <h2>工单创建</h2>
            <label>工单号<input value={workOrderDraft.workOrderNo} onChange={(event) => setWorkOrderDraft({ ...workOrderDraft, workOrderNo: event.target.value })} placeholder="留空则自动生成" /></label>
            <label>产品名称<select value={workOrderDraft.productName} onChange={(event) => setWorkOrderDraft({ ...workOrderDraft, productName: event.target.value })} required><option value="未指定型号">未指定型号</option>{recipeOptions.map((recipe) => <option key={recipe.key} value={recipe.name}>{recipe.category} - {recipe.name}</option>)}</select></label>
            <label>计划数量<input type="number" min={1} value={workOrderDraft.planQty} onChange={(event) => setWorkOrderDraft({ ...workOrderDraft, planQty: Number(event.target.value) })} required /></label>
            <label>交付日期<input type="date" value={workOrderDraft.dueDate} onChange={(event) => setWorkOrderDraft({ ...workOrderDraft, dueDate: event.target.value })} required /></label>
            <button className="primary-action">创建工单</button>
        </form>
        <div className="product-table-panel">
            <WorkOrderTable
              workOrders={sortedActiveWorkOrders}
              onStatusChange={handleStatusChange}
              onCompletedQtyChange={handleCompletedQtyChange}
              onSave={handleSaveWorkOrder}
              onDelete={handleDeleteWorkOrder}
            />
            <ArchivedWorkOrderTable workOrders={sortedArchivedWorkOrders} />
        </div>
      </div>
    </section>
  )
}

function ProductionHeader({ title, subtitle, loading, onRefresh }: { title: string; subtitle: string; loading: boolean; onRefresh: () => void }) {
  return (
    <header className="page-header production-management-header">
      <div className="page-copy">
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="page-meta">
        <span className="status-line">MSSQL MES 在线</span>
        <button type="button" className="soft-action" onClick={onRefresh} disabled={loading}>
          {loading ? '刷新中' : '刷新'}
        </button>
      </div>
    </header>
  )
}

function ProductionSummaryStrip({ products, activeWorkOrders, runningQty, runningPlanQty, alarms }: {
  products: number
  activeWorkOrders: number
  runningQty: number
  runningPlanQty: number
  alarms: number
}) {
  const progress = runningPlanQty > 0 ? Math.min(100, Math.round((runningQty / runningPlanQty) * 100)) : 0
  return (
    <section className="summary-row production-summary-row">
      <SummaryMetric label="配方名称" value={products} />
      <SummaryMetric label="工单数量" value={activeWorkOrders} />
      <SummaryMetric label="执行任务" value={runningQty} progress={progress} />
      <SummaryMetric label="活动报警" value={alarms} />
    </section>
  )
}

function SummaryMetric({ label, value, progress }: { label: string; value: number; progress?: number }) {
  return (
    <div className="summary-item">
      <span>{label}</span>
      <strong>{value}</strong>
      {typeof progress === 'number' ? <div className="metric-progress"><div className="metric-progress-bar" style={{ width: `${progress}%` }} /></div> : null}
    </div>
  )
}

function WorkOrderTable({ workOrders, onStatusChange, onCompletedQtyChange, onSave, onDelete }: {
  workOrders: WorkOrder[]
  onStatusChange: (workOrder: WorkOrder, status: WorkOrderStatus) => void
  onCompletedQtyChange: (workOrder: WorkOrder, completedQty: number) => void
  onSave: (workOrder: WorkOrder, patch: Partial<Pick<WorkOrder, 'completedQty' | 'dueDate' | 'status' | 'productName'>>) => void
  onDelete: (workOrder: WorkOrder) => void
}) {
  if (workOrders.length === 0) return <div className="empty-state">暂无工单</div>

  const runningId = workOrders.find((workOrder) => workOrder.status === '执行中')?.id ?? 0

  return (
    <div className="table-shell workorder-table-shell">
      <table className="workorder-table">
        <thead>
          <tr>
            <th>工单号</th>
            <th>产品名称</th>
            <th className="workorder-col-center">计划数量</th>
            <th className="workorder-col-center">完工数量</th>
            <th className="workorder-col-center">进度</th>
            <th className="workorder-col-center">状态</th>
            <th className="workorder-col-center">交付日期</th>
            <th className="workorder-col-center">操作</th>
          </tr>
        </thead>
          <tbody>
            {workOrders.map((workOrder) => {
              const pending = workOrder.status === '待执行'
              const running = workOrder.status === '执行中'
              const blockedByOtherRunning = pending && runningId > 0 && runningId !== workOrder.id
              const progress = getWorkOrderProgress(workOrder)
              return (
              <tr key={workOrder.id}>
                <td>{workOrder.workOrderNo}</td>
                <td>{workOrder.productName}</td>
                <td className="workorder-col-center">{workOrder.planQty}</td>
                <td className="workorder-col-center"><input key={`${workOrder.id}-${workOrder.completedQty}`} className="workorder-qty-input" type="number" min={0} max={workOrder.planQty} defaultValue={workOrder.completedQty} onBlur={(event) => onCompletedQtyChange(workOrder, Number(event.target.value))} /></td>
                <td className="workorder-col-center"><WorkOrderProgressBar progress={progress} /></td>
                <td className="workorder-col-center"><span className={`workorder-status ${statusClass(workOrder.status)}`}>{workOrder.status}</span></td>
                <td className="workorder-col-center"><input className="workorder-date-input" type="date" defaultValue={formatDate(workOrder.dueDate)} onChange={(event) => onSave(workOrder, { dueDate: event.target.value })} /></td>
                <td className="workorder-col-center">
                  <div className="workorder-actions">
                    {running ? <button type="button" className="mini-button workorder-revert-button" onClick={() => onStatusChange(workOrder, '待执行')}>退回待执行</button> : null}
                    {pending && !blockedByOtherRunning ? <button type="button" className="mini-button workorder-start-button" title="开始执行当前工单" onClick={() => onStatusChange(workOrder, '执行中')}>开始执行</button> : null}
                    {running ? <button type="button" className="mini-button workorder-archive-button" onClick={() => {
                      const message = workOrder.completedQty < workOrder.planQty
                        ? `当前完工数量 ${workOrder.completedQty} 小于计划数量 ${workOrder.planQty}，确认要完工归档吗？`
                        : '确认将当前工单设为完工归档吗？'
                      if (window.confirm(message)) onStatusChange(workOrder, '完工归档')
                    }}>完工归档</button> : null}
                    {!pending && !running ? <span className="workorder-action-placeholder">-</span> : null}
                    {pending ? <button type="button" className="mini-button danger" onClick={() => onDelete(workOrder)}>删除</button> : null}
                  </div>
                </td>
              </tr>
            )})}
          </tbody>
        </table>
      </div>
  )
}

function ArchivedWorkOrderTable({ workOrders }: { workOrders: WorkOrder[] }) {
  if (workOrders.length === 0) return <div className="empty-state">暂无完工归档工单</div>

  return (
    <div className="table-shell workorder-table-shell">
      <table className="workorder-table">
        <thead>
          <tr>
            <th>归档工单号</th>
            <th>产品名称</th>
            <th className="workorder-col-center">计划数量</th>
            <th className="workorder-col-center">完工数量</th>
            <th className="workorder-col-center">进度</th>
            <th className="workorder-col-center">状态</th>
            <th className="workorder-col-center">交付日期</th>
            <th className="workorder-col-center">归档时间</th>
          </tr>
        </thead>
        <tbody>
          {workOrders.map((workOrder) => {
            const progress = getWorkOrderProgress(workOrder)
            return (
              <tr key={workOrder.id}>
                <td>{workOrder.workOrderNo}</td>
                <td>{workOrder.productName}</td>
                <td className="workorder-col-center">{workOrder.planQty}</td>
                <td className="workorder-col-center">{workOrder.completedQty}</td>
                <td className="workorder-col-center"><WorkOrderProgressBar progress={progress} /></td>
                <td className="workorder-col-center"><span className="workorder-status archived">{workOrder.status}</span></td>
                <td className="workorder-col-center">{formatDate(workOrder.dueDate)}</td>
                <td className="workorder-col-center">{formatDateTime(workOrder.archivedAt)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function WorkOrderProgressBar({ progress }: { progress: number }) {
  return (
    <div className="workorder-progress" aria-label={`进度 ${progress}%`}>
      <span style={{ width: `${progress}%` }} />
      <em>{progress}%</em>
    </div>
  )
}

function getWorkOrderProgress(workOrder: WorkOrder) {
  if (workOrder.planQty <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((workOrder.completedQty / workOrder.planQty) * 100)))
}

function statusClass(status: WorkOrderStatus) {
  if (status === '执行中') return 'running'
  if (status === '完工归档') return 'archived'
  return 'pending'
}

async function syncWorkOrderNoToLocalOrderNoTags(workOrder: WorkOrder) {
  const workOrderNo = workOrder.workOrderNo.trim()
  if (!workOrderNo) {
    throw new Error('工单号为空，无法同步到 Local.OrderNo')
  }

  const orderNoTags = await getLocalOrderNoTags()
  await Promise.all(orderNoTags.map((tag) => writeTag(tag.id, workOrderNo)))
}

async function clearLocalOrderNoTags() {
  const orderNoTags = await getLocalOrderNoTags()
  await Promise.all(orderNoTags.map((tag) => writeTag(tag.id, '')))
}

async function getLocalOrderNoTags() {
  const tags = await getTags()
  const orderNoTags = tags
    .map((tag) => ({ tag, index: getLocalOrderNoIndex(tag) }))
    .filter((item): item is { tag: TagDefinition; index: number } => item.index >= 1 && item.index <= 50)
    .sort((left, right) => left.index - right.index)

  if (orderNoTags.length !== 50) {
    throw new Error(`Local OrderNo 变量数量不正确：当前 ${orderNoTags.length} 个，应为 50 个`)
  }

  return orderNoTags.map(({ tag }) => tag)
}

function shouldClearLocalOrderNoTags(workOrders: WorkOrder[]) {
  const currentWorkOrders = workOrders.filter((workOrder) => workOrder.status !== '完工归档')
  return currentWorkOrders.length === 0 || currentWorkOrders.every((workOrder) => workOrder.status === '待执行')
}

function getLocalOrderNoIndex(tag: TagDefinition) {
  if ((tag.groupKey ?? '').trim().toLowerCase() !== 'local') return -1
  const candidates = [tag.displayName, tag.browseName, tag.nodeId]
  for (const candidate of candidates) {
    const match = candidate.match(/(?:^|[._/])OrderNo\[(\d+)\]$/i) ?? candidate.match(/OrderNo_(\d+)$/i)
    if (match) return Number(match[1])
  }
  return -1
}

function sortWorkOrders(left: WorkOrder, right: WorkOrder) {
  return right.dueDate.localeCompare(left.dueDate)
}

function formatDate(value: string) {
  return value ? value.slice(0, 10) : '-'
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}
