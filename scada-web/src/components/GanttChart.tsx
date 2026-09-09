import type { CSSProperties, ReactNode } from 'react'

/* ============================================================
 * 通用甘特图组件(与具体业务解耦)
 *
 * 布局:一张白色卡片内从左到右依次为
 *   1) 左侧标签列 —— 每个 lane 一行,显示 label + 可选 sublabel;
 *   2) 中间共享时间轴轨道区 —— 顶部一条整点刻度轴(HH:00),
 *      整点处有贯穿所有轨道的细分隔竖线,每个 lane 一条水平轨道,
 *      segments 按时间比例绝对定位成色块(块与块留 1px 缝),title 悬浮提示;
 *   3) 右侧可选明细列 —— lane.right 渲染在对应行的行尾。
 *
 * 时间解析统一用 new Date,不依赖任何第三方库。
 * ============================================================ */

export interface GanttChartSegment {
  /** 段开始时间(时间串),必须能被 new Date 解析 */
  start: string
  /** 段结束时间,必须晚于 start 才会被绘制 */
  end: string
  /** 段填充色(hex/rgb 等 CSS 颜色均可) */
  color: string
  /** 悬浮提示文本 */
  title?: string
}

export interface GanttChartLane {
  id: string | number
  label: ReactNode
  /** label 下方的辅助说明(任意 ReactNode) */
  sublabel?: ReactNode
  /** 渲染在轨道行尾的明细内容(任意 ReactNode) */
  right?: ReactNode
  /** 整行(左列+轨道区)背景色,缺省时左列用浅蓝、轨道区白 */
  rowBackground?: string
  segments: GanttChartSegment[]
}

export interface GanttChartProps {
  /** 时间轴窗口起点(时间串或时间戳) */
  windowStart: string | number
  /** 时间轴窗口终点(时间串或时间戳),必须晚于 windowStart */
  windowEnd: string | number
  /** 纵向轨道列表,每个 lane 一条水平轨道 */
  lanes: GanttChartLane[]
  /** 每条轨道(行)高度 px,默认 44 */
  heightPerLane?: number
  /** 左侧标签列宽度 px,默认 220 */
  leftWidth?: number
  /** 右侧明细列宽度 px,默认 0(不渲染) */
  rightWidth?: number
  /** 仅渲染轨道区(供嵌进外部卡片):去掉外层白卡样式,且 leftWidth<=0 时隐藏左列 */
  bare?: boolean
  /** 是否显示顶部时间刻度轴,默认 true(多卡并列时可只让第一张显示) */
  showAxis?: boolean
  /** 时间窗口无效或没有任何轨道时的占位文案 */
  emptyText?: string
}

const AXIS_HEIGHT = 22
// 同行相邻色块之间的横向缝隙(px);0 = 首尾相接
const SEGMENT_GAP = 0

const cardStyle: CSSProperties = {
  background: '#ffffff',
  border: '1px solid #e7edf7',
  borderRadius: 0,
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.04)',
  overflow: 'hidden',
  minWidth: 0,
}

const sideColStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  overflow: 'hidden',
  boxSizing: 'border-box',
}

const laneLabelStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: '18px',
  fontWeight: 600,
  color: '#1f2a3b',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}

const laneSublabelStyle: CSSProperties = {
  fontSize: 11,
  lineHeight: '15px',
  color: '#6b7686',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  marginTop: 1,
  minWidth: 0,
}

const tickLabelStyle: CSSProperties = {
  position: 'absolute',
  top: 4,
  fontSize: '0.68rem',
  lineHeight: '12px',
  color: '#7c8698',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  zIndex: 2,
  userSelect: 'none',
}

const emptyBoxStyle: CSSProperties = {
  minHeight: 120,
  display: 'grid',
  placeItems: 'center',
  color: '#8a93a9',
  fontSize: 13,
  padding: '24px 16px',
  boxSizing: 'border-box',
}

/** 悬浮高亮;类名前缀 gnt- 避免与全局样式冲突 */
const SEGMENT_HOVER_CSS = `.gnt-seg:hover{filter:brightness(0.95);box-shadow:0 1px 4px rgba(15,23,42,0.28);z-index:5;}`

function parseMs(value: string | number): number {
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : Number.NaN
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

interface AxisTick {
  label: string
  leftPct: number
}

/** 与原效率页 buildTicks 一致的策略:首刻度 = 窗口起点后的第一个整点,之后逐小时 +1h */
function buildTicks(startMs: number, endMs: number): AxisTick[] {
  const first = new Date(startMs)
  first.setMinutes(0, 0, 0)
  if (first.getTime() < startMs) {
    first.setHours(first.getHours() + 1)
  }

  const span = endMs - startMs
  const ticks: AxisTick[] = []
  for (let time = first.getTime(); time <= endMs; time += 3_600_000) {
    ticks.push({
      label: `${pad2(new Date(time).getHours())}:00`,
      leftPct: clampPct(((time - startMs) / span) * 100),
    })
  }
  return ticks
}

/** 段相对窗口的几何(left/width 均为 0..100 百分比);无效或完全在窗口外返回 null */
function getSegmentGeometry(
  segment: GanttChartSegment,
  minMs: number,
  spanMs: number,
): { left: number; width: number } | null {
  const start = parseMs(segment.start)
  const end = parseMs(segment.end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  // 完全落在窗口之外(前面/后面)的段直接跳过
  if (end <= minMs || start >= minMs + spanMs) return null

  const left = clampPct(((start - minMs) / spanMs) * 100)
  const right = clampPct(((end - minMs) / spanMs) * 100)
  if (right - left <= 0) return null
  return { left, width: right - left }
}

/** 首尾刻度避免被裁切:首刻度左对齐、末刻度右对齐,中间居中 */
function axisLabelPosition(leftPct: number): { left: string; transform: string; marginLeft?: number; marginRight?: number } {
  if (leftPct <= 1.5) {
    return { left: `${leftPct}%`, transform: 'none', marginLeft: 4 }
  }
  if (leftPct >= 98.5) {
    return { left: `${leftPct}%`, transform: 'translateX(-100%)', marginRight: 4 }
  }
  return { left: `${leftPct}%`, transform: 'translateX(-50%)' }
}

export function GanttChart({
  windowStart,
  windowEnd,
  lanes,
  heightPerLane = 44,
  leftWidth = 220,
  rightWidth = 0,
  bare = false,
  showAxis = true,
  emptyText = '暂无数据',
}: GanttChartProps) {
  const containerStyle: CSSProperties = bare ? { minWidth: 0, width: '100%' } : cardStyle
  const laneHeight = heightPerLane > 0 ? heightPerLane : 44
  const minMs = parseMs(windowStart)
  const maxMs = parseMs(windowEnd)
  const spanMs = maxMs - minMs
  const windowValid = Number.isFinite(minMs) && Number.isFinite(maxMs) && spanMs > 0
  // 隐藏时间轴时,轨道直接从顶部开始,避免留下空白
  const axisH = showAxis ? AXIS_HEIGHT : 0

  const ticks = windowValid ? buildTicks(minMs, maxMs) : []

  if (!windowValid || lanes.length === 0) {
    return (
      <div style={containerStyle}>
        <style>{SEGMENT_HOVER_CSS}</style>
        <div style={emptyBoxStyle}>{emptyText}</div>
      </div>
    )
  }

  const rowsHeight = lanes.length * laneHeight
  const ganttHeight = axisH + rowsHeight
  // 色块高度:轨道太高时封顶 30px,整体垂直居中
  const blockHeight = Math.max(10, Math.min(30, laneHeight - 16))
  const blockTop = (laneHeight - blockHeight) / 2

  const rowBoxStyle = (): CSSProperties => ({
    height: laneHeight,
    flex: '0 0 auto',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    boxSizing: 'border-box',
    minWidth: 0,
    overflow: 'hidden',
    padding: '4px 8px',
  })

  return (
    <div style={containerStyle}>
      <style>{SEGMENT_HOVER_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'stretch', minWidth: 0 }}>
        {/* 左侧标签列(leftWidth<=0 时不渲染) */}
        {leftWidth > 0 && (
          <div
            style={{ ...sideColStyle, flex: `0 0 ${leftWidth}px`, width: leftWidth, borderRight: '1px solid #e7edf7' }}
          >
          <div style={{ height: AXIS_HEIGHT, flex: '0 0 auto', background: '#eef3fc' }} aria-hidden="true" />
          {lanes.map((lane) => (
            <div key={lane.id} style={{ ...rowBoxStyle(), background: lane.rowBackground ?? '#eef3fc' }}>
              <div style={laneLabelStyle}>{lane.label}</div>
              {lane.sublabel != null && <div style={laneSublabelStyle}>{lane.sublabel}</div>}
            </div>
          ))}
          </div>
        )}

        {/* 中间共享时间轴轨道区 */}
        <div
          style={{ flex: '1 1 auto', minWidth: 0, position: 'relative', height: ganttHeight, overflow: 'hidden' }}
          role="img"
          aria-label={`${lanes.length} 条轨道共享时间轴甘特图`}
        >
          {/* 顶部共享刻度轴(仅在 showAxis 时渲染) */}
          {showAxis &&
            ticks.map((tick, index) => {
              const pos = axisLabelPosition(tick.leftPct)
              return (
                <div key={`tick-${index}-${tick.label}-${tick.leftPct}`} style={{ ...tickLabelStyle, ...pos }}>
                  {tick.label}
                </div>
              )
            })}

          {/* 每个 lane 一条水平轨道 */}
          {lanes.map((lane, laneIndex) => (
            <div
              key={lane.id}
              style={{
                position: 'absolute',
                top: axisH + laneIndex * laneHeight,
                left: 0,
                right: 0,
                height: laneHeight,
                zIndex: 1,
                backgroundColor: lane.rowBackground,
              }}
            >
              {lane.segments.map((segment, segmentIndex) => {
                const geometry = getSegmentGeometry(segment, minMs, spanMs)
                if (!geometry) return null
                return (
                  <div
                    key={`${lane.id}-${segmentIndex}-${segment.start}`}
                    className="gnt-seg"
                    title={segment.title}
                    style={{
                      position: 'absolute',
                      left: `${geometry.left}%`,
                      width: `calc(${geometry.width}% - ${SEGMENT_GAP}px)`,
                      top: blockTop,
                      height: blockHeight,
                      backgroundColor: segment.color,
                      borderRadius: 3,
                      cursor: segment.title ? 'help' : 'default',
                      minWidth: SEGMENT_GAP,
                    }}
                  />
                )
              })}
            </div>
          ))}
        </div>

        {/* 右侧可选明细列 */}
        {rightWidth > 0 && (
          <div
            style={{ ...sideColStyle, flex: `0 0 ${rightWidth}px`, width: rightWidth, borderLeft: '1px solid #e7edf7' }}
          >
            <div style={{ height: AXIS_HEIGHT, flex: '0 0 auto' }} aria-hidden="true" />
            {lanes.map((lane) => (
              <div key={lane.id} style={rowBoxStyle()}>
                {lane.right}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
