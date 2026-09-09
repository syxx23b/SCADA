import type { CSSProperties } from 'react'
import type { EfficiencyTimelineLane, EfficiencyTimelineResponse } from '../types'
import { GanttChart } from './GanttChart'
import type { GanttChartLane, GanttChartSegment } from './GanttChart'

/* ============================================================
 * 效率分析页:多个工位合并进一张大甘特图
 *  - 每工位(lane)= 一张水平轨道,共享同一条顶部时间轴;
 *  - 左侧标签列:工位名 + OEE;
 *  - 右侧明细列:3 个工作状态(待机/测试中/报警)累计时长 chips + OEE;
 *  - 未工作不再画轨道/色块,靠轨道上的空白时间表达;
 *  - 顶部图例行 + 窗口时间说明。
 * ============================================================ */

const LEGEND_ITEMS: Array<{ key: EfficiencyTimelineLane['currentStateKey']; label: string; color: string }> = [
  { key: 'disconnected', label: '未工作', color: '#dadce0' },
  { key: 'standby', label: '待机', color: '#eace21' },
  { key: 'running', label: '测试中', color: '#2eaa4a' },
  { key: 'fault', label: '报警', color: '#ca3333' },
]

/** 甘特子轨/统计只使用工作状态 3 条;disconnected(未工作)只作为“当前无工作段”的
 *  状态回退存在,不作为轨道、不作为段绘制(服务端也不再下发 disconnected 段)。 */
const WORK_STATE_ITEMS = LEGEND_ITEMS.filter((item) => item.key !== 'disconnected')

const COLOR_BY_STATE = new Map(LEGEND_ITEMS.map((item) => [item.key, item.color] as const))

type LiveStateMap = Partial<
  Record<
    number,
    {
      stateKey: EfficiencyTimelineLane['currentStateKey']
      stateLabel: string
      colorHex: string
    }
  >
>

const pageShellClassName = 'page-shell report-page-shell report-config-shell'

const stripCardStyle: CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e7edf7',
  borderRadius: 0,
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
  padding: '10px 16px',
  boxSizing: 'border-box',
}

const emptyCardStyle: CSSProperties = {
  ...stripCardStyle,
  minHeight: 220,
  display: 'grid',
  placeItems: 'center',
  color: '#8a93a9',
  fontSize: 13,
}

function EfficiencyTitle() {
  return (
    <header className="production-header efficiency-header">
      <div className="production-title">效率分析</div>
    </header>
  )
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatDurationText(durationMs: number) {
  const hours = durationMs / 3_600_000
  return hours >= 1 ? `${hours.toFixed(1)} h` : `${Math.round(durationMs / 60_000)} min`
}

/** 每站:3 个工作状态的累计时长 + OEE(running / (standby + running + fault)) */
function buildSummary(lane: EfficiencyTimelineLane) {
  const totals = new Map<string, number>()
  for (const segment of lane.segments) {
    const start = new Date(segment.startedAt).getTime()
    const end = new Date(segment.endedAt).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    totals.set(segment.stateKey, (totals.get(segment.stateKey) ?? 0) + (end - start))
  }

  const items = WORK_STATE_ITEMS.map((item) => ({
    key: item.key,
    label: item.label,
    color: COLOR_BY_STATE.get(item.key) ?? '#dadce0',
    durationText: formatDurationText(totals.get(item.key) ?? 0),
  }))

  const standbyMs = totals.get('standby') ?? 0
  const runningMs = totals.get('running') ?? 0
  const faultMs = totals.get('fault') ?? 0
  const oeeBaseMs = standbyMs + runningMs + faultMs
  const oeeText = oeeBaseMs > 0 ? `${((runningMs / oeeBaseMs) * 100).toFixed(1)}%` : '-'

  return { items, oeeText }
}

export function EfficiencyAnalysis({
  data,
  loading,
  liveStateByFaceplate,
}: {
  data: EfficiencyTimelineResponse | null
  loading: boolean
  liveStateByFaceplate?: LiveStateMap
}) {
  // 保留签名与 App 调用兼容;当前状态行已不下发,live 覆盖暂不使用。
  void liveStateByFaceplate
  if (!data) {
    return (
      <section className={pageShellClassName}>
        <EfficiencyTitle />
        <div style={emptyCardStyle}>{loading ? '效率分析加载中…' : '暂无效率分析数据'}</div>
      </section>
    )
  }

  if (data.lanes.length === 0) {
    return (
      <section className={pageShellClassName}>
        <EfficiencyTitle />
        <div style={emptyCardStyle}>暂无效率分析数据</div>
      </section>
    )
  }

  const toSegment = (segment: EfficiencyTimelineLane['segments'][number]): GanttChartSegment => {
    const startMs = new Date(segment.startedAt).getTime()
    const endMs = new Date(segment.endedAt).getTime()
    const durationMs = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs ? endMs - startMs : 0
    return {
      start: segment.startedAt,
      end: segment.endedAt,
      color: segment.colorHex,
      title: `${segment.stateLabel} | ${formatDateTime(segment.startedAt)} - ${formatDateTime(segment.endedAt)} | 持续: ${formatDurationText(durationMs)}`,
    }
  }

  return (
    <section className={pageShellClassName}>
      <EfficiencyTitle />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {data.lanes.map((lane, stationIndex) => {
          const stateLanes: GanttChartLane[] = WORK_STATE_ITEMS.map((item) => ({
            id: `${lane.faceplateIndex}-${item.key}`,
            label: '',
            segments: lane.segments.filter((segment) => segment.stateKey === item.key).map(toSegment),
          }))

          return (
            <article
              key={lane.faceplateIndex}
              style={{
                background: '#ffffff',
                border: '1px solid #e7edf7',
                borderRadius: 0,
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'stretch',
              }}
            >
              {/* 左侧标签区:工位名 + OEE,竖排居中 */}
              <div
                style={{
                  flex: '0 0 84px',
                  width: 84,
                  background: '#d6e4fb',
                  borderRight: '1px solid #d7e2f5',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 2,
                  padding: '4px 4px',
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    maxWidth: '100%',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    color: '#1f2a3b',
                    lineHeight: '16px',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {lane.stationName}
                </span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: '0.72rem',
                    color: '#4a5568',
                    whiteSpace: 'nowrap',
                    lineHeight: '15px',
                  }}
                  title="OEE = 测试时长 ÷ (待机 + 测试 + 报警) 时长"
                >
                  <span>OEE</span>
                  <span style={{ color: '#1d5bd6', fontWeight: 700 }}>{buildSummary(lane).oeeText}</span>
                </span>
              </div>

              <div style={{ flex: '1 1 auto', minWidth: 0, padding: '6px 8px', boxSizing: 'border-box' }}>
                <GanttChart
                  bare
                  windowStart={data.windowStart}
                  windowEnd={data.windowEnd}
                  lanes={stateLanes}
                  heightPerLane={20}
                  leftWidth={0}
                  showAxis={stationIndex === 0}
                  emptyText="该时间窗口内暂无状态段数据"
                />
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
