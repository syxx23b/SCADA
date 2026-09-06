import type { FormEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { confirmRepairRecord } from '../api'
import type { ReworkHistoryResponse, ReworkLookupResponse } from '../types'

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

export function ReworkManagement({
  onSearch,
  onLoadHistory,
}: {
  onSearch: (tm: string) => Promise<ReworkLookupResponse>
  onLoadHistory: (tm: string) => Promise<ReworkHistoryResponse>
}) {
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ReworkLookupResponse | null>(null)
  const [history, setHistory] = useState<ReworkHistoryResponse | null>(null)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedMeasure, setSelectedMeasure] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [confirmMessage, setConfirmMessage] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const barcodeInputRef = useRef<HTMLInputElement | null>(null)

  const focusBarcodeInput = (selectText = false) => {
    const input = barcodeInputRef.current
    if (!input) return
    input.focus()
    if (selectText) input.select()
  }

  useEffect(() => {
    focusBarcodeInput(true)
  }, [])

  const historyTimeline = useMemo(() => {
    const events: Array<{ time: string; type: 'error' | 'repair'; title: string; detail: string }> = []
    for (const item of history?.errorItems ?? []) {
      if (!item.sj) continue
      events.push({
        time: item.sj,
        type: 'error',
        title: item.errInformation ?? (item.err != null ? `ERR ${item.err}` : 'Error'),
        detail: `工位: ${item.gw ?? '-'} / 订单: ${item.orderNo ?? '-'}`,
      })
    }
    for (const item of history?.repairItems ?? []) {
      if (!item.confirmedAt) continue
      events.push({
        time: item.confirmedAt,
        type: 'repair',
        title: item.repairMeasure || '-',
        detail: '返修确认',
      })
    }
    return events.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
  }, [history])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = keyword.trim()
    if (!trimmed) {
      setError('请输入查询条码')
      setResult(null)
      setHistory(null)
      setSearched(false)
      focusBarcodeInput(true)
      return
    }
    try {
      setLoading(true)
      setError(null)
      const [lookup, historyData] = await Promise.all([onSearch(trimmed), onLoadHistory(trimmed)])
      setResult(lookup)
      setHistory(historyData)
      setSearched(true)
      setSelectedMeasure(lookup.repairMeasures[0] ?? '')
      setConfirmMessage(null)
      setConfirmError(null)
      setTimeout(() => focusBarcodeInput(true), 0)
    } catch (searchError) {
      setResult(null)
      setHistory(null)
      setSearched(true)
      setError(searchError instanceof Error ? searchError.message : '返修记录查询失败')
      setTimeout(() => focusBarcodeInput(true), 0)
    } finally {
      setLoading(false)
    }
  }

  const handleConfirmRepair = async () => {
    if (!result?.found || !selectedMeasure) return
    try {
      setConfirming(true)
      setConfirmMessage(null)
      setConfirmError(null)
      const confirmed = await confirmRepairRecord({
        tm: result.tm,
        sj: result.sj,
        gw: result.gw,
        orderNo: result.orderNo,
        err: result.err,
        repairMeasure: selectedMeasure,
      })
      setConfirmMessage(`维修确认成功（ID: ${confirmed.id}，时间: ${confirmed.confirmedAt}）`)
      setKeyword('')
      setTimeout(() => focusBarcodeInput(true), 0)
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : '维修确认失败')
      setTimeout(() => focusBarcodeInput(true), 0)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <section className="production-page rework-page">
      <header className="production-header">
        <div className="production-title">返修管理</div>
      </header>

      <article className="production-card rework-query-card">
        <form className="rework-query-form" onSubmit={handleSubmit}>
          <label className="rework-query-label">
            <span>输入查询条码</span>
            <input
              ref={barcodeInputRef}
              className="rework-query-input"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onBlur={() => setTimeout(() => focusBarcodeInput(false), 0)}
              placeholder="请输入用于匹配 Error.tm 的条码"
            />
          </label>
          <button type="submit" className="primary-action rework-query-button" disabled={loading}>
            {loading ? '查询中...' : '查询'}
          </button>
        </form>
        {error ? <div className="rework-query-error">{error}</div> : null}
      </article>

      <article className="production-table-card rework-result-card">
        <div className="production-table-title">历史时间线</div>
        {!searched ? <div className="production-empty-inline">请输入查询条码后查询</div> : null}
        {searched && !result?.found ? <div className="production-empty-inline">未找到匹配的返修记录</div> : null}
        {searched && result?.found ? (
          <div className="rework-history-timeline">
            <table className="runtime-table">
              <thead>
                <tr>
                  <th>时间</th>
                  <th>类型</th>
                  <th>内容</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {historyTimeline.map((item, idx) => (
                  <tr key={`timeline-${idx}`} className={item.type === 'error' ? 'history-row-error' : 'history-row-repair'}>
                    <td>{formatDateTime(item.time)}</td>
                    <td>{item.type === 'error' ? 'Error' : '返修'}</td>
                    <td>{item.title}</td>
                    <td>{item.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>

      {searched && result?.found ? (
        <article className="production-table-card rework-result-card rework-repair-panel">
          <div className="production-table-title">维修措施选择</div>
          <div className="rework-result-mindmap">
            <div className="rework-map-center-pill rework-management-fault-pill">
              故障描述: <span className="rework-fault-description">{result.errInformation || '-'}</span>
            </div>
            <div className="rework-mindmap-aligned-grid rework-management-grid">
              <div className="rework-map-column-head suggestion">返修建议</div>
              <div className="rework-map-column-head measure">维修措施</div>
              {Array.from({ length: Math.max(result.reworkSuggestions.length, result.repairMeasures.length, 1) }).map((_, index) => (
                <div className="rework-map-aligned-row" key={`repair-row-${index}`}>
                  <div className={`rework-map-node suggestion${result.reworkSuggestions[index] ? '' : ' placeholder'}`}>
                    <div className="rework-map-node-content">{result.reworkSuggestions[index] ?? '-'}</div>
                  </div>
                  <div className={`rework-map-node measure${result.repairMeasures[index] ? '' : ' placeholder'}`}>
                    {result.repairMeasures[index] ? (
                      <label className="rework-measure-radio-item">
                        <input
                          type="radio"
                          name="repairMeasure"
                          value={result.repairMeasures[index]}
                          checked={selectedMeasure === result.repairMeasures[index]}
                          onChange={() => setSelectedMeasure(result.repairMeasures[index]!)}
                        />
                        <span>{result.repairMeasures[index]}</span>
                      </label>
                    ) : (
                      <div className="rework-map-node-content">-</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="rework-confirm-actions">
              {keyword.trim() ? (
                <button
                  type="button"
                  className="primary-action rework-confirm-button"
                  disabled={confirming || (result.repairMeasures?.length ?? 0) === 0 || !selectedMeasure}
                  onClick={() => void handleConfirmRepair()}
                >
                  {confirming ? '维修确认中...' : '维修确认'}
                </button>
              ) : null}
              {confirmMessage ? <div className="rework-confirm-success">{confirmMessage}</div> : null}
              {confirmError ? <div className="rework-query-error">{confirmError}</div> : null}
            </div>
          </div>
        </article>
      ) : null}
    </section>
  )
}

