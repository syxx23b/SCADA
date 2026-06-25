import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createReworkMapping,
  createReworkMeasure,
  createReworkSuggestion,
  deleteReworkMapping,
  deleteReworkMeasure,
  deleteReworkSuggestion,
  getReworkConfigEntries,
  getReworkConfigGraph,
} from '../api'
import type { ReworkConfigEntriesResponse, ReworkConfigGraphResponse, ReworkMeasureNode } from '../types'

export function ReworkConfig({ onStatus }: { onStatus: (message: string) => void }) {
  const [loading, setLoading] = useState(false)
  const [graph, setGraph] = useState<ReworkConfigGraphResponse>({ errNodes: [], measureNodes: [], edges: [] })
  const [entries, setEntries] = useState<ReworkConfigEntriesResponse>({
    err: 0,
    suggestions: [],
    measures: [],
    measureCatalog: [],
  })
  const [errFilter, setErrFilter] = useState('')
  const [selectedErr, setSelectedErr] = useState<number | null>(null)
  const [newSuggestion, setNewSuggestion] = useState('')
  const [newMeasure, setNewMeasure] = useState('')
  const [selectedMeasureId, setSelectedMeasureId] = useState<number | null>(null)

  const loadGraph = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await getReworkConfigGraph()
      setGraph(response)
      if ((selectedErr ?? 0) <= 0 && response.errNodes.length > 0) {
        setSelectedErr(response.errNodes[0].err)
      }
    } catch (error) {
      onStatus(error instanceof Error ? error.message : '返修组态图谱加载失败')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [onStatus, selectedErr])

  const loadEntries = useCallback(async (err: number, silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await getReworkConfigEntries(err)
      setEntries(response)
      if (response.measureCatalog.length > 0 && !selectedMeasureId) {
        setSelectedMeasureId(response.measureCatalog[0].id)
      }
    } catch (error) {
      onStatus(error instanceof Error ? error.message : '返修组态列表加载失败')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [onStatus, selectedMeasureId])

  useEffect(() => {
    void loadGraph()
  }, [loadGraph])

  useEffect(() => {
    if ((selectedErr ?? 0) > 0) {
      void loadEntries(selectedErr!, true)
    }
  }, [selectedErr, loadEntries])

  const filteredErrNodes = useMemo(() => {
    const keyword = errFilter.trim().toLowerCase()
    if (!keyword) return graph.errNodes
    return graph.errNodes.filter(
      (item) => item.err.toString().includes(keyword) || item.errInformation.toLowerCase().includes(keyword),
    )
  }, [errFilter, graph.errNodes])

  const selectedErrNode = useMemo(() => {
    return graph.errNodes.find((item) => item.err === selectedErr) ?? null
  }, [graph.errNodes, selectedErr])

  const alignedMindmapRows = useMemo(() => {
    const rowCount = Math.max(entries.suggestions.length, entries.measures.length, 1)
    return Array.from({ length: rowCount }, (_, index) => ({
      suggestion: entries.suggestions[index] ?? null,
      measure: entries.measures[index] ?? null,
    }))
  }, [entries.measures, entries.suggestions])

  const measureById = useMemo(() => {
    const map = new Map<number, ReworkMeasureNode>()
    graph.measureNodes.forEach((item) => map.set(item.id, item))
    return map
  }, [graph.measureNodes])

  const handleCreateSuggestion = async () => {
    const content = newSuggestion.trim()
    if (!content) return onStatus('请输入返修建议内容')
    if (!selectedErr) return onStatus('请先选择故障代码')
    setLoading(true)
    try {
      await createReworkSuggestion(selectedErr, content)
      setNewSuggestion('')
      await loadEntries(selectedErr, true)
      onStatus('返修建议已新增')
    } catch (error) {
      onStatus(error instanceof Error ? error.message : '新增返修建议失败')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteSuggestion = async (id: number) => {
    setLoading(true)
    try {
      await deleteReworkSuggestion(id)
      if (selectedErr) await loadEntries(selectedErr, true)
      onStatus('返修建议已删除')
    } catch (error) {
      onStatus(error instanceof Error ? error.message : '删除返修建议失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateMeasure = async () => {
    const content = newMeasure.trim()
    if (!content) return onStatus('请输入维修措施内容')
    setLoading(true)
    try {
      const created = await createReworkMeasure(content)
      setNewMeasure('')
      setSelectedMeasureId(created.id)
      await loadGraph(true)
      if (selectedErr) await loadEntries(selectedErr, true)
      onStatus('维修措施已新增')
    } catch (error) {
      onStatus(error instanceof Error ? error.message : '新增维修措施失败')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteMeasure = async (id: number) => {
    setLoading(true)
    try {
      const relatedMappings = graph.edges.filter((edge) => edge.knowledgeId === id)
      if (relatedMappings.length > 0) {
        await Promise.all(relatedMappings.map((edge) => deleteReworkMapping(edge.id)))
      }
      await deleteReworkMeasure(id)
      await loadGraph(true)
      if (selectedErr) await loadEntries(selectedErr, true)
      onStatus('维修措施已删除')
    } catch (error) {
      onStatus(error instanceof Error ? error.message : '删除维修措施失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateMapping = async () => {
    if (!selectedErr) return onStatus('请先选择故障代码')
    if (!selectedMeasureId) return onStatus('请先选择维修措施')
    setLoading(true)
    try {
      await createReworkMapping(selectedErr, selectedMeasureId)
      await loadGraph(true)
      await loadEntries(selectedErr, true)
      onStatus('匹配关系已建立（排序自动分配）')
    } catch (error) {
      onStatus(error instanceof Error ? error.message : '建立匹配关系失败')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteMapping = async (id: number) => {
    setLoading(true)
    try {
      await deleteReworkMapping(id)
      await loadGraph(true)
      if (selectedErr) await loadEntries(selectedErr, true)
      onStatus('匹配关系已删除')
    } catch (error) {
      onStatus(error instanceof Error ? error.message : '删除匹配关系失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="production-page rework-config-page">
      <header className="production-header">
        <div className="production-title">返修组态</div>
        <div className="production-subtitle">建议按故障代码独立管理，维修措施全局管理并跨故障代码复用</div>
      </header>

      <div className="rework-config-shell">
        <aside className="production-card rework-config-panel">
          <div className="rework-config-panel-title">故障代码列表</div>
          <input
            className="rework-query-input"
            placeholder="搜索故障代码 / 故障描述"
            value={errFilter}
            onChange={(event) => setErrFilter(event.target.value)}
          />
          <div className="rework-config-err-list">
            {filteredErrNodes.map((node) => (
              <button
                key={node.err}
                type="button"
                className={`rework-config-err-item${selectedErr === node.err ? ' active' : ''}`}
                onClick={() => setSelectedErr(node.err)}
              >
                <div className="rework-config-err-inline">
                  <strong>故障代码 {node.err}</strong>
                  <span>{node.errInformation}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main className="rework-config-main">
          <section className="production-card rework-config-card rework-config-global-measure-card">
            <div className="rework-config-panel-title">维修措施（全局）</div>
            <div className="rework-config-row">
              <input
                className="rework-query-input"
                placeholder="输入维修措施"
                value={newMeasure}
                onChange={(event) => setNewMeasure(event.target.value)}
              />
              <button type="button" className="primary-action" onClick={() => void handleCreateMeasure()} disabled={loading}>
                新增
              </button>
            </div>
            <div className="rework-measure-chip-list">
              {entries.measureCatalog.length === 0 ? (
                <div className="rework-map-empty">暂无维修措施</div>
              ) : (
                entries.measureCatalog.map((item) => (
                  <div key={`m-${item.id}`} className="rework-measure-chip">
                    <span>{item.itemContent}</span>
                    <button type="button" onClick={() => void handleDeleteMeasure(item.id)} aria-label={`delete-measure-${item.id}`}>
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          <div className="rework-config-top">
            <section className="production-card rework-config-card">
              <div className="rework-config-panel-title">返修建议（当前故障代码）</div>
              <div className="rework-config-row">
                <input
                  className="rework-query-input"
                  placeholder="输入返修建议"
                  value={newSuggestion}
                  onChange={(event) => setNewSuggestion(event.target.value)}
                />
                <button type="button" className="primary-action" onClick={() => void handleCreateSuggestion()} disabled={loading}>
                  新增
                </button>
              </div>
              <table className="production-table">
                <thead>
                  <tr>
                    <th>内容</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.suggestions.map((item) => (
                    <tr key={`s-${item.id}`}>
                      <td>{item.itemContent}</td>
                      <td>
                        <button type="button" onClick={() => void handleDeleteSuggestion(item.id)}>删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="production-card rework-config-card">
              <div className="rework-config-panel-title">当前故障代码匹配关系</div>
              <div className="rework-config-row">
                <select value={selectedMeasureId ?? ''} onChange={(event) => setSelectedMeasureId(Number(event.target.value))}>
                  <option value="">选择维修措施</option>
                  {entries.measureCatalog.map((item) => (
                    <option key={`sel-${item.id}`} value={item.id}>{item.itemContent}</option>
                  ))}
                </select>
                <button type="button" className="primary-action" onClick={() => void handleCreateMapping()} disabled={loading}>
                  建立匹配
                </button>
              </div>
              <table className="production-table">
                <thead>
                  <tr>
                    <th>已匹配措施</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.measures.map((item) => (
                    <tr key={`map-row-${item.mappingId}`}>
                      <td>{item.itemContent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          <section className="production-card rework-mindmap-card">
            <div className="rework-config-panel-title">思维导图</div>
            {!selectedErrNode ? (
              <div className="production-empty-inline">请选择左侧故障代码</div>
            ) : (
              <div className="rework-mindmap-modern">
                <div className="rework-map-center-pill">{selectedErrNode.errInformation}</div>
                <div className="rework-mindmap-aligned-grid">
                  <div className="rework-map-column-head suggestion">返修建议</div>
                  <div className="rework-map-column-head measure">维修措施</div>
                  {alignedMindmapRows.map((row, index) => (
                    <div className="rework-map-aligned-row" key={`aligned-row-${index}`}>
                      <div className={`rework-map-node suggestion${row.suggestion ? '' : ' placeholder'}`}>
                        <div className="rework-map-node-content">{row.suggestion?.itemContent ?? '-'}</div>
                      </div>
                      <div className={`rework-map-node measure${row.measure ? '' : ' placeholder'}`}>
                        {row.measure ? (
                          <div className="rework-map-node-row">
                            <div className="rework-map-node-content">
                              {measureById.get(row.measure.knowledgeId)?.itemContent ?? row.measure.itemContent}
                            </div>
                            <div className="rework-map-node-actions rework-map-node-actions-inline">
                              <button type="button" onClick={() => void handleDeleteMapping(row.measure.mappingId)}>
                                删除匹配关系
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="rework-map-node-content">-</div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </main>
      </div>
    </section>
  )
}
