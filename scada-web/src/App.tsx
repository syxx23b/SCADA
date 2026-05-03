import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { HubConnectionBuilder, LogLevel } from '@microsoft/signalr'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import './App.css'
import { browseDevice, connectDevice, createDevice, createTag, deleteDevice, deleteTag, disconnectDevice, exportAllTagsExcel, getDevices, getRuntimeOverview, getTags, getEfficiencyTimeline, getProductionTodayByGw, getFaultTodayByGw, getLatestReworkByTm, getRepairRecordDaily, getRepairRecords, getReworkHistoryByTm, importTagsExcelReplace, openVncTool, updateDevice, updateTag, writeTag, getRecipes, getRecipe, createRecipe, updateRecipe, deleteRecipe } from './api'

import type { BrowseNode, DeviceConnection, DeviceFormState, EfficiencyTimelineResponse, FaultByGwResponse, ProductionByGwResponse, RepairRecordDailyResponse, RepairRecordListResponse, ReworkHistoryResponse, ReworkLookupResponse, RuntimeOverview, TagDefinition, TagFormState, TagSnapshot } from './types'
import { EfficiencyAnalysis } from './components/EfficiencyAnalysis'
import { FaultAnalysis } from './components/FaultAnalysis'
import { ProductionStatistics } from './components/ProductionStatistics'
import { ReworkManagement } from './components/ReworkManagement'
import { ReworkConfig } from './components/ReworkConfig'
import { ReworkRecords } from './components/ReworkRecords'
import { RecipeDJ } from './components/RecipeDJ'
import { RecipeQYJ } from './components/RecipeQYJ'




type ViewKey =
  | 'dashboard'
  | 'factoryReportDj'
  | 'factoryReportMotor'
  | 'factoryReportQyj'
  | 'factoryReportEngine'
  | 'enduranceReportDj'
  | 'enduranceReportMotor'
  | 'enduranceReportQyj'
  | 'enduranceReportEngine'
  | 'efficiency'
  | 'fault'
  | 'production'
  | 'rework'
  | 'reworkConfig'
  | 'reworkRecords'
  | 'runtime'
  | 'tags'
  | 'recipeDj'
  | 'recipeQyj'
  | 'reportConfig'
  | 'help'
  | 'login'
type SidebarKey = ViewKey

type RecipeTypeKey = 'DJRecipe' | 'QYJRecipe'
type RuntimeStatus = { label: '正常' | '异常'; className: 'normal' | 'fault' }
const LOCAL_DEVICE_ID = '__local__'

type HistoryPoint = { ts: number; value: number }
type DashboardField = { tag?: TagDefinition; snapshot?: TagSnapshot; healthy: boolean; numeric: number | null; text: string; emptyText: string }
type FaceplateTrend = { pressure: HistoryPoint[]; flow: HistoryPoint[] }
type SidebarItem = { key: SidebarKey; label: string; icon: ReactNode }
type WriteOptions = { refreshRuntime?: boolean; successMessage?: string | null }

const EMPTY_DEVICE_FORM: DeviceFormState = {
  name: '',
  driverKind: 'OpcUa',
  endpointUrl: '',
  securityMode: 'None',
  securityPolicy: 'None',
  authMode: 'Anonymous',
  username: '',
  password: '',
  autoConnect: true,
}

const DRIVER_LABELS: Record<string, string> = {
  OpcUa: 'OPC UA',
  SiemensS7: 'Siemens S7',
}

const LOGIN_SOFTWARE_VERSION = 'SoftwareVersion'
const LOGIN_GIT_VERSION = (import.meta.env.VITE_GIT_VERSION as string | undefined)?.trim() || 'unknown'
const LOGIN_GIT_DATETIME = (import.meta.env.VITE_GIT_DATETIME as string | undefined)?.trim() || 'unknown'
const LOGIN_SUBTITLE = `${LOGIN_SOFTWARE_VERSION}_${LOGIN_GIT_DATETIME}_Git:${LOGIN_GIT_VERSION}`

function EfficiencySidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 2.5V13.5H13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 10L7.2 7.3L9.2 9.3L12 5.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="4.5" cy="10" r="0.8" fill="currentColor" />
      <circle cx="7.2" cy="7.3" r="0.8" fill="currentColor" />
      <circle cx="9.2" cy="9.3" r="0.8" fill="currentColor" />
      <circle cx="12" cy="5.8" r="0.8" fill="currentColor" />
    </svg>
  )
}

function ProductionSidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.5 13.5H13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="3.2" y="8.4" width="2.2" height="4.2" rx="0.7" fill="currentColor" />
      <rect x="6.9" y="6.4" width="2.2" height="6.2" rx="0.7" fill="currentColor" />
      <rect x="10.6" y="4.2" width="2.2" height="8.4" rx="0.7" fill="currentColor" />
    </svg>
  )
}

type ReworkIconSet = 1 | 2 | 3 | 4
const REWORK_ICON_SET: ReworkIconSet = 4

function ReworkManageIcon({ set }: { set: ReworkIconSet }) {
  if (set === 4) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.1 5.1V2.1H5.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10.9 2.1H13.9V5.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M13.9 10.9V13.9H10.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5.1 13.9H2.1V10.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="4.5" y="4.5" width="1.8" height="1.8" rx="0.3" fill="currentColor" />
        <rect x="7.1" y="4.5" width="1.2" height="1.2" rx="0.25" fill="currentColor" />
        <rect x="9" y="4.5" width="1.8" height="1.8" rx="0.3" fill="currentColor" />
        <rect x="4.5" y="7.1" width="1.2" height="1.2" rx="0.25" fill="currentColor" />
        <rect x="6.7" y="7.1" width="2.6" height="2.6" rx="0.35" stroke="currentColor" strokeWidth="1.1" />
        <rect x="10.1" y="7.1" width="1.2" height="1.2" rx="0.25" fill="currentColor" />
        <rect x="4.5" y="9.9" width="1.8" height="1.8" rx="0.3" fill="currentColor" />
        <rect x="7.4" y="10.2" width="1.2" height="1.2" rx="0.25" fill="currentColor" />
        <rect x="9.6" y="9.9" width="1.8" height="1.8" rx="0.3" fill="currentColor" />
      </svg>
    )
  }
  if (set === 2) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M2.2 6H9V10H2.2V6Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M9 6.8H12.2L13.8 8L12.2 9.2H9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4.2 10V12.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="5.8" cy="8" r="0.7" fill="currentColor" />
      </svg>
    )
  }
  if (set === 3) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2.3" y="5.2" width="6.4" height="3.6" rx="0.9" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8.8 6H11.8L13.5 7L11.8 8H8.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M3.9 8.8V12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M6.6 8.8V11.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.2 3.1H6.9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M3.2 5.1V6.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M9.1 3.1H10.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12.8 5.1V6.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M5.2 12.9H6.9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M3.2 9.2V10.9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M9.1 12.9H10.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M12.8 9.2V10.9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function ReworkConfigIcon({ set }: { set: ReworkIconSet }) {
  if (set === 2) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M5.5 3.2H10.5V5.1L12.3 6.9L10.5 8.7V10.6H5.5V8.7L3.7 6.9L5.5 5.1V3.2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <circle cx="8" cy="6.9" r="1.4" stroke="currentColor" strokeWidth="1.2" />
        <path d="M8 1.8V2.9M8 10.9V12.2M2.9 6.9H1.8M14.2 6.9H13.1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    )
  }
  if (set === 3) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M10.8 2.8L13.2 5.2L11.7 6.7L9.3 4.3L10.8 2.8Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M9.3 4.3L4 9.6V12.8H7.2L12.5 7.5" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M4.9 11.9H8.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9.5 2.4L12.4 5.3L10.7 7L7.8 4.1L9.5 2.4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M7.8 4.1L3.2 8.7V12.8H7.3L11.9 8.2" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M4.8 11.2H7.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function ReworkRecordIcon({ set }: { set: ReworkIconSet }) {
  if (set === 2) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="2.4" y="2.4" width="11.2" height="11.2" rx="1.8" stroke="currentColor" strokeWidth="1.4" />
        <path d="M4.8 5.4H11.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M4.8 8H11.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M4.8 10.6H8.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    )
  }
  if (set === 3) {
    return (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3 2.5H9.3L13 6.2V13.5H3V2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M9.3 2.5V6.2H13" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M5 8.2H11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M5 10.4H9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 2.5H9.2L13 6.3V13.5H3V2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9.2 2.5V6.3H13" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M5 8.2H11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M5 10.4H9.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function DashboardSidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="2" width="5" height="3" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="7" width="5" height="7" rx="1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  )
}

function FactoryRecordSidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 2.5H9.2L13 6.3V13.5H3V2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9.2 2.5V6.3H13" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M5 8.2H11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M5 10.4H9.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function FaultSidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 1.8L14 13.2H2L8 1.8Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M8 5.6V9.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="11.5" r="0.9" fill="currentColor" />
    </svg>
  )
}

function DownloadSidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4.8 11.6H11.5C13 11.6 14.2 10.4 14.2 8.9C14.2 7.5 13.1 6.4 11.8 6.2C11.5 4.2 9.8 2.7 7.7 2.7C5.5 2.7 3.7 4.4 3.6 6.6C2.3 6.9 1.4 8 1.4 9.3C1.4 10.6 2.4 11.6 3.7 11.6H4.8Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 6.4V12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M5.9 9.9L8 12L10.1 9.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function UserLoginSidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="5.2" r="2.3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.4 12.5C4.1 10.3 5.8 9.2 8 9.2C10.2 9.2 11.9 10.3 12.6 12.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function ReportConfigSidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.3" y="2.3" width="11.4" height="11.4" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 5.5H11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M5 8H11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M5 10.5H8.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function TagSidebarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.2 2.8H3.5C3.1 2.8 2.8 3.1 2.8 3.5V6.2C2.8 6.5 2.9 6.8 3.1 7L8.8 12.7C9.1 13 9.6 13 9.9 12.7L12.7 9.9C13 9.6 13 9.1 12.7 8.8L7 3.1C6.8 2.9 6.5 2.8 6.2 2.8Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <circle cx="5.1" cy="5.1" r="0.7" fill="currentColor" />
    </svg>
  )
}

function SidebarCollapseIcon({ collapsed }: { collapsed: boolean }) {
  return collapsed ? (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M5 3.5L8.5 7L5 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M9 3.5L5.5 7L9 10.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const baseSidebarItems: SidebarItem[] = [
  { key: 'dashboard', label: '数据看板', icon: <DashboardSidebarIcon /> },
  { key: 'factoryReportDj', label: '出厂记录-电机泵', icon: <FactoryRecordSidebarIcon /> },
  { key: 'factoryReportMotor', label: 'FactoryReport-Motor', icon: <FactoryRecordSidebarIcon /> },
  { key: 'factoryReportQyj', label: '出厂记录-汽油机', icon: <FactoryRecordSidebarIcon /> },
  { key: 'factoryReportEngine', label: 'FactoryReport-Engine', icon: <FactoryRecordSidebarIcon /> },
  { key: 'enduranceReportDj', label: '耐久报表-电机泵', icon: <FactoryRecordSidebarIcon /> },
  { key: 'enduranceReportMotor', label: 'EnduranceReport-Motor', icon: <FactoryRecordSidebarIcon /> },
  { key: 'enduranceReportQyj', label: '耐久报表-汽油机', icon: <FactoryRecordSidebarIcon /> },
  { key: 'enduranceReportEngine', label: 'EnduranceReport-Engine', icon: <FactoryRecordSidebarIcon /> },
  { key: 'efficiency', label: '效率分析', icon: <EfficiencySidebarIcon /> },
  { key: 'fault', label: '故障分析', icon: <FaultSidebarIcon /> },
  { key: 'production', label: '产量统计', icon: <ProductionSidebarIcon /> },
  { key: 'rework', label: '返修管理', icon: <ReworkManageIcon set={REWORK_ICON_SET} /> },
  { key: 'reworkConfig', label: '返修组态', icon: <ReworkConfigIcon set={REWORK_ICON_SET} /> },
  { key: 'reworkRecords', label: '返修记录', icon: <ReworkRecordIcon set={REWORK_ICON_SET} /> },
  { key: 'recipeDj', label: '配方-电机泵', icon: <DownloadSidebarIcon /> },
  { key: 'recipeQyj', label: '配方-汽油机', icon: <DownloadSidebarIcon /> },
  { key: 'help', label: '帮助', icon: '？' },
]

const protectedSidebarItems: SidebarItem[] = [
  { key: 'runtime', label: '标签', icon: <TagSidebarIcon /> },
  { key: 'tags', label: '订阅', icon: '◎' },
  { key: 'reportConfig', label: '报表配置', icon: <ReportConfigSidebarIcon /> },
]

const DASHBOARD_TEMPLATE_FIELDS = [
  'barcode',
  'automode0_factory1_endurance',
  'current',
  'enduranceprocess',
  'errcode',
  'failnumber',
  'flow',
  'frequency',
  'inletpressure',
  'inlettemp',
  'lasttimehour',
  'lasttimeminute',
  'nozzlesize',
  'passnumber',
  'power',
  'powerfactor',
  'pressure',
  'siphon',
  'speed',
  'stationnumber',
  'triggercount',
  'triggeroffprocess',
  'triggeronprocess',
  'voltage',
  'workflow',
] as const

function getInitialView(): ViewKey {
  const value = new URLSearchParams(window.location.search).get('view')
  if (value === 'batch') return 'tags'
  return value === 'dashboard' || value === 'factoryReportDj' || value === 'factoryReportMotor' || value === 'factoryReportQyj' || value === 'factoryReportEngine' || value === 'enduranceReportDj' || value === 'enduranceReportMotor' || value === 'enduranceReportQyj' || value === 'enduranceReportEngine' || value === 'efficiency' || value === 'fault' || value === 'production' || value === 'rework' || value === 'reworkConfig' || value === 'reworkRecords' || value === 'runtime' || value === 'tags' || value === 'recipeDj' || value === 'recipeQyj' || value === 'reportConfig' || value === 'help' || value === 'login' ? value : 'dashboard'
}

const FACTORY_REPORT_PARAMS = 'ref_t=design&ref_c=5d7ff465-26b4-4e0c-baca-346f29bfb3c7'
const FACTORY_REPORT_ENCODED_PATH = 'QYJ%25E5%2587%25BA%25E5%258E%2582%25E6%25B5%258B%25E8%25AF%2595%25E6%258A%25A5%25E8%25A1%25A8Eng.cpt'
const FACTORY_REPORT_CN_PATH = 'QYJ%25E5%2587%25BA%25E5%258E%2582%25E6%25B5%258B%25E8%25AF%2595%25E6%258A%25A5%25E8%25A1%25A8.cpt'
const REPORT_SERVER_BASE_URL = ''
const REPORT_VISIBILITY_STORAGE_KEY = 'scada-web.report-visibility'
const STATION_COUNT_STORAGE_KEY = 'scada-web.station-count'
const DEFAULT_STATION_COUNT = 4
const MAX_STATION_COUNT = 64
type FactoryReportKey = 'factoryReportDj' | 'factoryReportMotor' | 'factoryReportQyj' | 'factoryReportEngine'
type ReportKey = FactoryReportKey | 'enduranceReportDj' | 'enduranceReportMotor' | 'enduranceReportQyj' | 'enduranceReportEngine'
type ReworkServiceKey = 'rework' | 'reworkConfig' | 'reworkRecords'
const REPORT_SERVICE_KEYS: ReportKey[] = [
  'factoryReportDj',
  'factoryReportMotor',
  'factoryReportQyj',
  'factoryReportEngine',
  'enduranceReportDj',
  'enduranceReportMotor',
  'enduranceReportQyj',
  'enduranceReportEngine',
]
const REWORK_SERVICE_KEYS: ReworkServiceKey[] = ['rework', 'reworkConfig', 'reworkRecords']
const MENU_VISIBILITY_KEYS = [...REPORT_SERVICE_KEYS, ...REWORK_SERVICE_KEYS] as const
type MenuVisibilityKey = (typeof MENU_VISIBILITY_KEYS)[number]

const REPORTS: Record<ReportKey, { title: string; subtitle: string; iframeUrl: string; openUrl: string }> = {
  factoryReportDj: {
    title: '出厂记录-电机泵',
    subtitle: 'DJ report integration test',
    iframeUrl: `${REPORT_SERVER_BASE_URL}/webroot/decision/view/report?viewlet=DJ%25E5%2587%25BA%25E5%258E%2582%25E6%25B5%258B%25E8%25AF%2595%25E6%258A%25A5%25E8%25A1%25A8.cpt&${FACTORY_REPORT_PARAMS}`,
    openUrl: `${REPORT_SERVER_BASE_URL}/webroot/decision/view/report?viewlet=DJ%25E5%2587%25BA%25E5%258E%2582%25E6%25B5%258B%25E8%25AF%2595%25E6%258A%25A5%25E8%25A1%25A8.cpt&${FACTORY_REPORT_PARAMS}`,
  },
  factoryReportMotor: {
    title: 'Factory Report-Motor',
    subtitle: 'Motor report integration test',
    iframeUrl: `${REPORT_SERVER_BASE_URL}/webroot/decision/view/report?viewlet=${FACTORY_REPORT_ENCODED_PATH}&${FACTORY_REPORT_PARAMS}`,
    openUrl: `${REPORT_SERVER_BASE_URL}/webroot/decision/view/report?viewlet=${FACTORY_REPORT_ENCODED_PATH}&${FACTORY_REPORT_PARAMS}`,
  },
  factoryReportQyj: {
    title: '出厂记录-汽油机',
    subtitle: 'QYJ report integration test',
    iframeUrl: `${REPORT_SERVER_BASE_URL}/webroot/decision/view/report?viewlet=${FACTORY_REPORT_CN_PATH}&${FACTORY_REPORT_PARAMS}`,
    openUrl: `${REPORT_SERVER_BASE_URL}/webroot/decision/view/report?viewlet=${FACTORY_REPORT_CN_PATH}&${FACTORY_REPORT_PARAMS}`,
  },
  factoryReportEngine: {
    title: 'Factory Report-Engine',
    subtitle: 'Engine report integration test',
    iframeUrl: `${REPORT_SERVER_BASE_URL}/webroot/decision/view/report?viewlet=${FACTORY_REPORT_ENCODED_PATH}&${FACTORY_REPORT_PARAMS}`,
    openUrl: `${REPORT_SERVER_BASE_URL}/webroot/decision/view/report?viewlet=${FACTORY_REPORT_ENCODED_PATH}&${FACTORY_REPORT_PARAMS}`,
  },
  enduranceReportDj: {
    title: '耐久报表-电机泵',
    subtitle: 'DJ endurance report integration test',
    iframeUrl: `${REPORT_SERVER_BASE_URL}/webroot/decision/view/report?viewlet=DJ%25E8%2580%2590%25E4%25B9%2585%25E6%25B5%258B%25E8%25AF%2595%25E6%258A%25A5%25E8%25A1%25A8.cpt&${FACTORY_REPORT_PARAMS}`,
    openUrl: `${REPORT_SERVER_BASE_URL}/webroot/decision/view/report?viewlet=DJ%25E8%2580%2590%25E4%25B9%2585%25E6%25B5%258B%25E8%25AF%2595%25E6%258A%25A5%25E8%25A1%25A8.cpt&${FACTORY_REPORT_PARAMS}`,
  },
  enduranceReportMotor: {
    title: 'Endurance Report-Motor',
    subtitle: 'DJ endurance report integration test',
    iframeUrl: `${REPORT_SERVER_BASE_URL}/webroot/decision/view/report?viewlet=DJ%25E8%2580%2590%25E4%25B9%2585%25E6%25B5%258B%25E8%25AF%2595%25E6%258A%25A5%25E8%25A1%25A8Eng.cpt&${FACTORY_REPORT_PARAMS}`,
    openUrl: `${REPORT_SERVER_BASE_URL}/webroot/decision/view/report?viewlet=DJ%25E8%2580%2590%25E4%25B9%2585%25E6%25B5%258B%25E8%25AF%2595%25E6%258A%25A5%25E8%25A1%25A8Eng.cpt&${FACTORY_REPORT_PARAMS}`,
  },
  enduranceReportQyj: {
    title: '耐久报表-汽油机',
    subtitle: 'QYJ endurance report integration test',
    iframeUrl: `${REPORT_SERVER_BASE_URL}/webroot/decision/view/report?viewlet=QYJ%25E8%2580%2590%25E4%25B9%2585%25E6%25B5%258B%25E8%25AF%2595%25E6%258A%25A5%25E8%25A1%25A8.cpt&${FACTORY_REPORT_PARAMS}`,
    openUrl: `${REPORT_SERVER_BASE_URL}/webroot/decision/view/report?viewlet=QYJ%25E8%2580%2590%25E4%25B9%2585%25E6%25B5%258B%25E8%25AF%2595%25E6%258A%25A5%25E8%25A1%25A8.cpt&${FACTORY_REPORT_PARAMS}`,
  },
  enduranceReportEngine: {
    title: 'Endurance Report-Engine',
    subtitle: 'QYJ endurance report integration test',
    iframeUrl: `${REPORT_SERVER_BASE_URL}/webroot/decision/view/report?viewlet=QYJ%25E8%2580%2590%25E4%25B9%2585%25E6%25B5%258B%25E8%25AF%2595%25E6%258A%25A5%25E8%25A1%25A8Eng.cpt&${FACTORY_REPORT_PARAMS}`,
    openUrl: `${REPORT_SERVER_BASE_URL}/webroot/decision/view/report?viewlet=QYJ%25E8%2580%2590%25E4%25B9%2585%25E6%25B5%258B%25E8%25AF%2595%25E6%258A%25A5%25E8%25A1%25A8Eng.cpt&${FACTORY_REPORT_PARAMS}`,
  },
}

function normalizeStationCount(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_STATION_COUNT
  return Math.max(1, Math.min(MAX_STATION_COUNT, Math.trunc(value)))
}

function createStationIndexes(stationCount: number) {
  return Array.from({ length: normalizeStationCount(stationCount) }, (_, index) => index + 1)
}

function readInitialStationCount() {
  try {
    const raw = window.localStorage.getItem(STATION_COUNT_STORAGE_KEY)
    if (!raw) return DEFAULT_STATION_COUNT
    return normalizeStationCount(Number(raw))
  } catch {
    return DEFAULT_STATION_COUNT
  }
}



function getDisplayName(nodeId: string) {
  let value = nodeId
  const index = value.indexOf(';s=')
  if (index >= 0) value = value.slice(index + 3)
  if (value.startsWith('|var|')) value = value.slice(5)
  const appIndex = value.indexOf('.Application.')
  if (appIndex >= 0) value = value.slice(appIndex + '.Application.'.length)
  return value || nodeId
}

function normalizeTagPath(rawValue: string) {
  const trimmed = rawValue.trim()
  const nodeIdIndex = trimmed.indexOf(';s=')
  return nodeIdIndex >= 0 ? trimmed.slice(nodeIdIndex + 3) : trimmed
}

function findTagByExactPath(tags: TagDefinition[], exactPath: string) {
  const normalizedExactPath = normalizeTagPath(exactPath).toLowerCase()
  return tags.find((tag) => {
    const candidates = [tag.displayName, tag.browseName, getDisplayName(tag.nodeId)]
    return candidates.some((rawValue) => normalizeTagPath(rawValue ?? '').toLowerCase() === normalizedExactPath)
  }) ?? null
}

function resolveRecipeItemTag(tags: TagDefinition[], recipeItemKey: string) {
  const normalizedKey = recipeItemKey.trim().toLowerCase()
  const byId = tags.find((tag) => tag.id.toLowerCase() === normalizedKey)
  if (byId) return byId
  return findTagByExactPath(tags, recipeItemKey)
}

function normalizeLocalRecipeDisplayName(value: string) {
  const trimmed = value.trim()

  // RecipeName patterns (dot and underscore versions)
  const recipeNameMatch = trimmed.match(/^Local\.Recipe_DB\.RecipeName(\[\d+\])$/i)
  if (recipeNameMatch) return `Local.RecipeName${recipeNameMatch[1]}`

  const recipeNameUnderscoreMatch = trimmed.match(/^Local\.Recipe_DB_RecipeName(\[\d+\])$/i)
  if (recipeNameUnderscoreMatch) return `Local.RecipeName${recipeNameUnderscoreMatch[1]}`

  // DJRecipe patterns (dot and underscore versions)
  const djMatch = trimmed.match(/^Local\.Recipe_DB\.DJRecipe(?:\[\d+\])?\.(.+)$/i)
  if (djMatch) return `Local.RecipeDJ.${djMatch[1].trim()}`

  const djUnderscoreMatch = trimmed.match(/^Local\.Recipe_DB_DJRecipe(?:\[\d+\])?_(.+)$/i)
  if (djUnderscoreMatch) return `Local.RecipeDJ.${djUnderscoreMatch[1].trim()}`

  // Plain Local variables (non-Recipe) -> RecipeDJ
  const plainMatch = trimmed.match(/^Local\.([^.]+)(?:\.[^.]+)*$/i)
  if (plainMatch && !trimmed.toLowerCase().startsWith('local.recipe')) {
    return `Local.RecipeDJ.${plainMatch[1].trim()}`
  }

  return trimmed
}

function resolveLocalRecipeGroupFromDisplay(_value?: string) {
  return 'Local'
}

function getResolvedGroup(deviceName: string, tag: TagDefinition) {
  const recipeRule = resolveRecipeRule(tag.nodeId)
  if (recipeRule) return recipeRule.groupKey

  const explicit = tag.groupKey?.trim()
  if (isLocalVariableGroup(explicit)) {
    return resolveLocalRecipeGroupFromDisplay(tag.displayName) ?? explicit ?? 'Local Variable'
  }

  if (explicit) return explicit
  const match = getDisplayName(tag.nodeId).match(/HMI_DB\.(?:HMI_Faceplates|Faceplates)\[(\d+)\]/i)
  return match ? `${deviceName}_HMI${match[1]}` : '未分组'
}

function isLocalVariableGroup(groupKey: string | null | undefined) {
  const normalized = (groupKey ?? '').trim().toLowerCase()
  return normalized === 'local' ||
    normalized === 'local variable' ||
    normalized === 'device1_localvariable' ||
    normalized === 'local.recipedj'
}

function isLocalVariableTag(tag: TagDefinition) {
  return isLocalVariableGroup(tag.groupKey)
}

function isLocalRecipeScopedTag(tag: TagDefinition) {
  if (isLocalVariableGroup(tag.groupKey)) return true

  const candidates = [tag.displayName, tag.browseName, getDisplayName(tag.nodeId)]
  return candidates.some((rawValue) => {
    const value = (rawValue ?? '').trim()
    return /^Local\./i.test(value) || /^LocalVariable\./i.test(value) || /^Recipe_DB\./i.test(value)
  })
}

function BrandAnimatedTitle() {
  return (
    <svg className="brand-animated-title" viewBox="0 0 380 84" role="img" aria-label="清洗机测试系统">
      <text x="8" y="60">清洗机测试系统</text>
    </svg>
  )
}

function compareGroupOption(left: string, right: string) {
  const leftParts = left.trim().toUpperCase().split(/(\d+)/).filter(Boolean)
  const rightParts = right.trim().toUpperCase().split(/(\d+)/).filter(Boolean)
  const maxLength = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] ?? ''
    const rightPart = rightParts[index] ?? ''
    const leftIsNumber = /^\d+$/.test(leftPart)
    const rightIsNumber = /^\d+$/.test(rightPart)

    if (leftIsNumber && rightIsNumber) {
      const diff = Number(leftPart) - Number(rightPart)
      if (diff !== 0) return diff
      continue
    }

    if (leftPart === rightPart) continue
    return leftPart < rightPart ? -1 : 1
  }

  return 0
}

function sortGroupOptions(values: Iterable<string>) {
  const options = Array.from(new Set(values)).filter((value) => value !== 'all')
  options.sort(compareGroupOption)
  return ['all', ...options]
}

function detectLocalRecipeType(tag: TagDefinition, activeType?: RecipeTypeKey): RecipeTypeKey | null {
  const candidates = [tag.displayName, tag.browseName, getDisplayName(tag.nodeId)]

  for (const rawValue of candidates) {
    const value = (rawValue ?? '').trim()
    if (!value) continue

    // 配方名称标签 - 根据当前活动类型返回
    if (
      /^Local\.RecipeName/i.test(value) ||
      /^Local\.Recipe_DB\.RecipeName/i.test(value) ||
      /^Local\.Recipe_DB_RecipeName/i.test(value) ||
      /^LocalVariable\.RecipeName/i.test(value)
    ) {
      return activeType ?? 'DJRecipe'
    }

    if (
      /^Local\.RecipeDJ\./i.test(value) ||
      /^Local\.Recipe_DB\.DJRecipe(?:\[\d+\])?\./i.test(value) ||
      /^Local\.Recipe_DB_DJRecipe(?:\[\d+\])?_/i.test(value) ||
      /^LocalVariable\.DJRecipe\./i.test(value)
    ) {
      return 'DJRecipe'
    }

    if (
      /^Local\.RecipeQYJ\./i.test(value) ||
      /^Local\.Recipe_DB\.QYJRecipe(?:\[\d+\])?\./i.test(value) ||
      /^Local\.Recipe_DB_QYJRecipe(?:\[\d+\])?_/i.test(value) ||
      /^LocalVariable\.QYJRecipe\./i.test(value)
    ) {
      return 'QYJRecipe'
    }

  }

  return null
}

function isPrimaryLocalRecipeNameTag(tag: TagDefinition) {
  const candidates = [tag.displayName, tag.browseName, getDisplayName(tag.nodeId)]
  return candidates.some((rawValue) => {
    const value = (rawValue ?? '').trim()
    if (!value) return false
    return /^Local\.RecipeName$/i.test(value) ||
      /^Local\.Recipe_DB\.RecipeName$/i.test(value) ||
      /^Local\.Recipe_DB_RecipeName$/i.test(value) ||
      /^Recipe_DB\.RecipeName$/i.test(value) ||
      /^LocalVariable\.RecipeName$/i.test(value)
  })
}

function isLocalRecipeNameTag(tag: TagDefinition) {
  const candidates = [tag.displayName, tag.browseName, getDisplayName(tag.nodeId)]
  return candidates.some((rawValue) => {
    const value = (rawValue ?? '').trim()
    if (!value) return false
    return /^(?:Local\.)?(?:RecipeName|Recipe_DB\.RecipeName|Recipe_DB_RecipeName)(?:\[\d+\])?$/i.test(value) ||
      /^Recipe_DB\.RecipeName(?:\[\d+\])?$/i.test(value) ||
      /^LocalVariable\.RecipeName(?:\[\d+\])?$/i.test(value)
  })
}

function isExactRecipeDbRecipeNameTag(tag: TagDefinition, slot: number): boolean {
  const target = `Recipe_DB.RecipeName[${slot}]`
  return (tag.displayName ?? '').trim() === target
}

function statusOf(tag: TagDefinition, snapshot: TagSnapshot | undefined, deviceStatus: string | undefined): RuntimeStatus {
  if (!snapshot) return { label: '异常', className: 'fault' }

  const q = (snapshot.quality ?? '').toLowerCase()
  const s = (snapshot.connectionState ?? '').toLowerCase()
  const qualityOk = q === '' || q === 'good' || q === '0' || q === '00000000' || q === '0000000'

  if (isLocalVariableTag(tag)) {
    const ok = qualityOk && (s === '' || s === 'connected' || s === 'localstatic')
    return ok ? { label: '正常', className: 'normal' } : { label: '异常', className: 'fault' }
  }

  const device = (deviceStatus ?? '').toLowerCase()
  if (device !== '' && device !== 'connected') return { label: '异常', className: 'fault' }
  const ok = (s === '' || s === 'connected') && qualityOk
  return ok ? { label: '正常', className: 'normal' } : { label: '异常', className: 'fault' }
}

type DeviceConnectionDisplay = {
  label: string
  className: 'normal' | 'warn' | 'fault'
  detail: string
}

function resolveDeviceConnectionDisplay(rawStatus: string | undefined, hasBadSnapshot: boolean, hasSnapshot: boolean): DeviceConnectionDisplay {
  const normalized = (rawStatus ?? '').trim().toLowerCase()

  if (normalized === 'connecting') {
    return { label: 'Connecting', className: 'warn', detail: '设备正在建立连接' }
  }

  if (normalized === 'reconnecting') {
    return { label: 'Reconnecting', className: 'warn', detail: '连接中断后正在自动重连' }
  }

  if (normalized === 'connected') {
    if (hasBadSnapshot) {
      return { label: 'NG', className: 'fault', detail: '连接已建立，但变量质量异常' }
    }

    if (!hasSnapshot) {
      return { label: 'Connected', className: 'warn', detail: '连接已建立，等待首包数据' }
    }

    return { label: 'Connected', className: 'normal', detail: '连接正常' }
  }

  if (normalized === 'faulted') {
    return { label: 'NG', className: 'fault', detail: '连接故障，等待自动重连' }
  }

  if (normalized === 'disconnected') {
    return { label: 'Disconnected', className: 'fault', detail: '连接已断开' }
  }

  return { label: rawStatus || 'Unknown', className: 'fault', detail: '连接状态未知' }
}

function isHealthySnapshot(tag: TagDefinition, snapshot: TagSnapshot | undefined, deviceStatus?: string) {
  return statusOf(tag, snapshot, deviceStatus).className === 'normal'
}

function formatValue(tag: TagDefinition, snapshot: TagSnapshot | undefined, deviceStatus?: string) {
  if (!isHealthySnapshot(tag, snapshot, deviceStatus)) return '-'
  if (snapshot?.value === null || snapshot?.value === undefined || snapshot?.value === '') return '-'
  if (typeof snapshot.value === 'number' && /float|single|double/i.test(tag.dataType)) return snapshot.value.toFixed(2)
  if (typeof snapshot.value === 'boolean') return snapshot.value ? 'True' : 'False'
  return String(snapshot.value)
}

function compactTimeText(snapshot: TagSnapshot | undefined) {
  if (!snapshot?.sourceTimestamp) return '-'
  const date = new Date(snapshot.sourceTimestamp)
  if (Number.isNaN(date.getTime())) return '-'
  const yyyy = date.getFullYear()
  const mm = date.getMonth() + 1
  const dd = date.getDate()
  const hh = String(date.getHours()).padStart(2, '0')
  const mi = String(date.getMinutes()).padStart(2, '0')
  const ss = String(date.getSeconds()).padStart(2, '0')
  return `${yyyy}/${mm}/${dd} ${hh}:${mi}:${ss}`
}

function inferUnit(label: string) {
  const value = label.toLowerCase()
  if (/inletpressure/.test(value)) return 'bar'
  if (/pressure|press/.test(value)) return 'MPa'
  if (/flow/.test(value)) return 'L/M'
  if (/power/.test(value)) return 'W'
  if (/temp|temperature/.test(value)) return '°C'
  if (/frequency|freq/.test(value)) return 'Hz'
  if (/current/.test(value)) return 'A'
  if (/voltage/.test(value)) return 'V'
  if (/speed|rpm/.test(value)) return 'rpm'
  if (/percent|ratio|rate/.test(value)) return '%'
  if (/time|hour/.test(value)) return 'h'
  if (/count|number|num/.test(value)) return 'pcs'
  return ''
}

function toNumericValue(value: TagSnapshot['value']) {
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const cleaned = value.replace(/,/g, '').match(/-?\d+(\.\d+)?/)
    const parsed = cleaned ? Number(cleaned[0]) : Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function formatNumberWithUnit(value: number | null, unit: string, digits?: number) {
  if (value === null) return `- ${unit}`.trim()
  const rounded =
    typeof digits === 'number'
      ? value.toFixed(digits)
      : Number.isInteger(value)
        ? value.toString()
        : value.toFixed(2)
  return unit ? `${rounded} ${unit}` : rounded
}

function formatCount(value: number | null) {
  if (value === null) return '-'
  return Number.isInteger(value) ? value.toString() : Math.round(value).toString()
}

function normalizeTrend(points: HistoryPoint[]) {
  if (points.length === 0) return []
  const usePoints = points.length === 1 ? [{ ts: points[0].ts - 60_000, value: points[0].value }, points[0]] : points
  const values = usePoints.map((point) => point.value)
  const sorted = [...values].sort((left, right) => left - right)
  const pick = (ratio: number) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)))]
  const q10 = pick(0.1)
  const q90 = pick(0.9)
  const center = (q10 + q90) / 2
  const halfRange = Math.max((q90 - q10) / 2, Math.max(...values.map((value) => Math.abs(value - center))) * 0.6, 0.5)
  const min = center - halfRange
  const max = center + halfRange
  const range = Math.max(max - min, 1e-6)
  return usePoints.map((point, index) => {
    const x = usePoints.length === 1 ? 100 : (index / (usePoints.length - 1)) * 100
    const normalized = Math.max(0, Math.min(1, (point.value - min) / range))
    const y = 40 - normalized * 34
    return { x, y, value: point.value }
  })
}

function errCodeToStatus(errCode: number) {
  const dictionary: Record<number, { text: string; className: 'normal' | 'fault' }> = {
    0: { text: '正常', className: 'normal' },
    1: { text: '不通电', className: 'fault' },
    2: { text: '低压启动失败', className: 'fault' },
    3: { text: '工作电流低', className: 'fault' },
    4: { text: '工作电流高', className: 'fault' },
    5: { text: '工作压力低', className: 'fault' },
    6: { text: '工作压力高', className: 'fault' },
    7: { text: '工作流量低', className: 'fault' },
    8: { text: '工作流量高', className: 'fault' },
    9: { text: '保压压力低', className: 'fault' },
    10: { text: '保压压力高', className: 'fault' },
    11: { text: '反冲压力低', className: 'fault' },
    12: { text: '反冲压力高', className: 'fault' },
    13: { text: '保压电流低', className: 'fault' },
    14: { text: '保压电流高', className: 'fault' },
    15: { text: '关枪不停机', className: 'fault' },
    16: { text: '吸液不合格', className: 'fault' },
    17: { text: '不保压', className: 'fault' },
    18: { text: '进水压力低', className: 'fault' },
    19: { text: '工压不稳', className: 'fault' },
    21: { text: '泵盖渗漏', className: 'fault' },
    22: { text: '泵体渗漏', className: 'fault' },
    23: { text: '油缸渗漏', className: 'fault' },
    24: { text: '电机异常', className: 'fault' },
    25: { text: '进水端异常', className: 'fault' },
    26: { text: '出水口异常', className: 'fault' },
    27: { text: '高压管漏水', className: 'fault' },
    28: { text: '外观异常', className: 'fault' },
    29: { text: '高压O形圈异常', className: 'fault' },
    30: { text: '其他异常', className: 'fault' },
    50: { text: '开枪跳动', className: 'fault' },
    51: { text: '关枪跳动', className: 'fault' },
  }
  return dictionary[errCode] ?? { text: `ErrCode ${errCode}`, className: 'fault' as const }
}

function workflowToLabel(workflow: number) {
  const dictionary: Record<number, string> = {
    0: '待命',
    1: '等待进水',
    2: '低压启动',
    3: '高压老化',
    4: '高压磨合',
    5: '常压磨合',
    6: '虹吸测试',
    7: '保压测试',
    8: '吹气清理',
  }
  return dictionary[workflow] ?? `未知流程(${workflow})`
}

function MiniSparkline({
  points,
  color,
}: {
  points: HistoryPoint[]
  color: string
}) {
  const [gradientId] = useState(() => `spark-${Math.random().toString(36).slice(2, 10)}`)
  const normalized = normalizeTrend(points)
  const hasPoints = normalized.length > 0
  const smoothPath = normalized.length <= 1
    ? normalized.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
    : normalized.slice(1).reduce((path, point, index) => {
      const prev = normalized[index]
      const cx = ((prev.x + point.x) / 2).toFixed(2)
      const cy = ((prev.y + point.y) / 2).toFixed(2)
      return `${path} Q ${prev.x.toFixed(2)} ${prev.y.toFixed(2)}, ${cx} ${cy}`
    }, `M ${normalized[0].x.toFixed(2)} ${normalized[0].y.toFixed(2)}`)
  const areaPath = hasPoints ? `${smoothPath} L 98 42 L 2 42 Z` : ''
  return (
    <svg className="dashboard-sparkline" viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {areaPath ? <path d={areaPath} fill={`url(#${gradientId})`} /> : null}
      {smoothPath ? <path d={smoothPath} fill="none" stroke={color} strokeWidth="1.9" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" /> : null}
    </svg>
  )
}

function DashboardProgressRing({ percent, color = '#605af3' }: { percent: number; color?: string }) {
  const safePercent = Math.max(0, Math.min(100, percent))
  const radius = 34
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - safePercent / 100)

  return (
    <svg className="dashboard-ring" viewBox="0 0 96 96" aria-hidden="true">
      <circle className="dashboard-ring-track" cx="48" cy="48" r={radius} />
      <circle className="dashboard-ring-value" cx="48" cy="48" r={radius} stroke={color} strokeDasharray={circumference} strokeDashoffset={dashOffset} />
      <text x="48" y="51" textAnchor="middle">
        {safePercent}%
      </text>
    </svg>
  )
}

function DashboardDualProgressRing({ percent, positive, negative }: { percent: number; positive: string; negative: string }) {
  const safePercent = Math.max(0, Math.min(100, percent))
  const radius = 34
  const circumference = 2 * Math.PI * radius
  const positiveLength = circumference * (safePercent / 100)
  const negativeLength = circumference - positiveLength

  return (
    <svg className="dashboard-ring" viewBox="0 0 96 96" aria-hidden="true">
      <circle className="dashboard-ring-track" cx="48" cy="48" r={radius} />
      <circle
        cx="48"
        cy="48"
        r={radius}
        fill="none"
        stroke={positive}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${positiveLength} ${circumference}`}
        transform="rotate(-90 48 48)"
      />
      <circle
        cx="48"
        cy="48"
        r={radius}
        fill="none"
        stroke={negative}
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${negativeLength} ${circumference}`}
        strokeDashoffset={-positiveLength}
        transform="rotate(-90 48 48)"
      />
      <text x="48" y="51" textAnchor="middle">
        {safePercent}%
      </text>
    </svg>
  )
}

function resolveRecipeRule(nodeId: string) {
  const displayName = getDisplayName(nodeId).trim()
  const match = displayName.match(/^Recipe_DB\.DJRecipe(?:\[(\d+)\]|(\d+))?(?:\.|$)/i)
  if (!match) return null
  const recipeIndex = Number(match[1] ?? match[2] ?? '1') === 2 ? 2 : 1
  return {
    groupKey: `Device1_Recipe${recipeIndex}`,
    intervalMs: 1000,
  }
}

function draftFromBrowse(deviceId: string, deviceName: string, node: BrowseNode): TagFormState {
  const displayName = getDisplayName(node.nodeId)
  const match = displayName.match(/HMI_DB\.(?:HMI_Faceplates|Faceplates)\[(\d+)\]/i)
  const recipeRule = resolveRecipeRule(node.nodeId)
  return {
    deviceId,
    nodeId: node.nodeId,
    browseName: node.browseName || node.displayName,
    displayName,
    dataType: node.dataType ?? 'Unknown',
    samplingIntervalMs: recipeRule?.intervalMs ?? 200,
    publishingIntervalMs: recipeRule?.intervalMs ?? 200,
    allowWrite: node.writable,
    enabled: true,
    groupKey: recipeRule?.groupKey ?? (match ? `${deviceName}_HMI${match[1]}` : '未分组'),
  }
}

function draftFromTag(tag: TagDefinition, deviceName: string): TagFormState {
  return { id: tag.id, deviceId: tag.deviceId, nodeId: tag.nodeId, browseName: tag.browseName, displayName: tag.displayName, dataType: tag.dataType, samplingIntervalMs: tag.samplingIntervalMs, publishingIntervalMs: tag.publishingIntervalMs, allowWrite: tag.allowWrite, enabled: tag.enabled, groupKey: tag.groupKey ?? getResolvedGroup(deviceName, tag) }
}

function App() {
  const [view, setView] = useState<ViewKey>(getInitialView)
  const [runtime, setRuntime] = useState<RuntimeOverview>({ devices: [], tags: [], snapshots: [] })
  const [devices, setDevices] = useState<DeviceConnection[]>([])
  const [tagRows, setTagRows] = useState<TagDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [savingTagId, setSavingTagId] = useState<string | null>(null)
  const [savingBatch, setSavingBatch] = useState(false)
  const [savingDevice, setSavingDevice] = useState(false)
  const [statusMessage, setStatusMessage] = useState('系统已就绪')
  const [groupFilter, setGroupFilter] = useState('all')
  const [selectedTagGroupFilter, setSelectedTagGroupFilter] = useState('all')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(true)
  const [brandAnimTick, setBrandAnimTick] = useState(0)
  const [reportFrameLoaded, setReportFrameLoaded] = useState(false)
  const [reportFrameTimeout, setReportFrameTimeout] = useState(false)
  const [reportFrameNonce, setReportFrameNonce] = useState(0)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const previousViewRef = useRef<ViewKey>(view)
  const [reportVisibility, setReportVisibility] = useState<Record<MenuVisibilityKey, boolean>>(() => {
    const fallback = MENU_VISIBILITY_KEYS.reduce((acc, key) => {
      acc[key] = true
      return acc
    }, {} as Record<MenuVisibilityKey, boolean>)

    try {
      const raw = window.localStorage.getItem(REPORT_VISIBILITY_STORAGE_KEY)
      if (!raw) return fallback
      const parsed = JSON.parse(raw) as Partial<Record<MenuVisibilityKey, boolean>>
      return MENU_VISIBILITY_KEYS.reduce((acc, key) => {
        acc[key] = parsed[key] ?? true
        return acc
      }, {} as Record<MenuVisibilityKey, boolean>)
    } catch {
      return fallback
    }
  })

  const [stationCount, setStationCount] = useState(readInitialStationCount)
  const dashboardFaceplateIndexes = useMemo(() => createStationIndexes(stationCount), [stationCount])

  const [writeDrafts, setWriteDrafts] = useState<Record<string, string>>({})
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [deviceDraft, setDeviceDraft] = useState<DeviceFormState>(EMPTY_DEVICE_FORM)
  const [browserSearch, setBrowserSearch] = useState('')
  const [expandedBrowseNodes, setExpandedBrowseNodes] = useState<Record<string, boolean>>({})
  const [browseCache, setBrowseCache] = useState<Record<string, BrowseNode[]>>({})
  const [browseLoadingKeys, setBrowseLoadingKeys] = useState<Record<string, boolean>>({})
  const [selectedBrowseNodes, setSelectedBrowseNodes] = useState<BrowseNode[]>([])
  const [batchDrafts, setBatchDrafts] = useState<TagFormState[]>([])
  const batchSectionRef = useRef<HTMLElement | null>(null)
  const importTagsFileInputRef = useRef<HTMLInputElement | null>(null)
  const efficiencyRequestPendingRef = useRef(false)
  const [dashboardTrendByFaceplate, setDashboardTrendByFaceplate] = useState<Record<number, FaceplateTrend>>({

    1: { pressure: [], flow: [] },
    2: { pressure: [], flow: [] },
    3: { pressure: [], flow: [] },
    4: { pressure: [], flow: [] },
  })
  const dashboardTagMapByFaceplateRef = useRef<Record<number, Map<string, TagDefinition>>>({})
  const snapshotByTagIdRef = useRef<Map<string, TagSnapshot>>(new Map())
  const runtimeDeviceStatusByIdRef = useRef<Record<string, string>>({})

  const runtimeNameById = useMemo(() => Object.fromEntries(runtime.devices.map((d) => [d.deviceId, d.deviceName])), [runtime.devices])
  const runtimeDeviceStatusById = useMemo(() => Object.fromEntries(runtime.devices.map((d) => [d.deviceId, d.status])), [runtime.devices])
  const deviceNameById = useMemo(() => Object.fromEntries(devices.map((d) => [d.id, d.name])), [devices])
  const snapshotByTagId = useMemo(() => new Map(runtime.snapshots.map((snapshot) => [snapshot.tagId, snapshot])), [runtime.snapshots])
  const hasLocalTags = useMemo(() => tagRows.some((tag) => isLocalVariableTag(tag)), [tagRows])
  const localDevice = useMemo(() => devices.find((device) => device.name.trim().toLowerCase() === 'local') ?? null, [devices])
  const selectableDevices = useMemo(() => {
    const base = devices.map((device) => ({ id: device.id, name: device.name, driverKind: device.driverKind }))
    return hasLocalTags && !localDevice ? [...base, { id: LOCAL_DEVICE_ID, name: 'Local', driverKind: 'Local' }] : base
  }, [devices, hasLocalTags, localDevice])
  const activeDeviceId = selectedDeviceId || localDevice?.id || selectableDevices[0]?.id || devices[0]?.id || runtime.devices[0]?.deviceId || ''
  const selectedDevice = useMemo(() => devices.find((device) => device.id === activeDeviceId) ?? null, [activeDeviceId, devices])
  const isLocalDeviceSelected = activeDeviceId === LOCAL_DEVICE_ID || selectedDevice?.name.trim().toLowerCase() === 'local'
  const activeDeviceName = isLocalDeviceSelected ? 'Local' : (deviceNameById[activeDeviceId] || runtimeNameById[activeDeviceId] || '当前设备')
  const isSiemensDevice = selectedDevice?.driverKind === 'SiemensS7'
  const rootBrowseKey = `${activeDeviceId}|__root__`
  const rootBrowseNodes = browseCache[rootBrowseKey] ?? []
  const rootBrowseLoading = Boolean(browseLoadingKeys[rootBrowseKey])
  const hasLoadedRootBrowse = Object.prototype.hasOwnProperty.call(browseCache, rootBrowseKey)
  const selectedDeviceTags = useMemo(() => {
    if (isLocalDeviceSelected) {
      return tagRows.filter((tag) => isLocalVariableTag(tag))
    }

    return tagRows.filter((tag) => tag.deviceId === activeDeviceId && !isLocalVariableTag(tag))
  }, [activeDeviceId, isLocalDeviceSelected, tagRows])
  const selectedDeviceTagGroups = useMemo(() => {
    const values = selectedDeviceTags.map((tag) => getResolvedGroup(activeDeviceName, tag))
    return sortGroupOptions(values)
  }, [activeDeviceName, selectedDeviceTags])
  const filteredSelectedDeviceTags = useMemo(() => {
    if (selectedTagGroupFilter === 'all') return selectedDeviceTags
    return selectedDeviceTags.filter((tag) => getResolvedGroup(activeDeviceName, tag) === selectedTagGroupFilter)
  }, [activeDeviceName, selectedDeviceTags, selectedTagGroupFilter])
  const batchRows = batchDrafts
  const activeRecipeType: RecipeTypeKey = view === 'recipeQyj' ? 'QYJRecipe' : 'DJRecipe'
  const isSiemensDraft = deviceDraft.driverKind === 'SiemensS7'

  // 配方文件管理状态 - 从服务器加载
  const [djRecipeFiles, setDjRecipeFiles] = useState<Array<{ id: string; name: string; createdAt: string; updatedAt: string }>>([])
  const [qyjRecipeFiles, setQyjRecipeFiles] = useState<Array<{ id: string; name: string; createdAt: string; updatedAt: string }>>([])

  // 当前加载的配方名称（用于更新子组件输入框）
  const [djLoadedRecipeName, setDjLoadedRecipeName] = useState<string>('')
  const [qyjLoadedRecipeName, setQyjLoadedRecipeName] = useState<string>('')
  const [efficiencyTimeline, setEfficiencyTimeline] = useState<EfficiencyTimelineResponse | null>(null)
  const [efficiencyLoading, setEfficiencyLoading] = useState(false)
  const [faultByGw, setFaultByGw] = useState<FaultByGwResponse | null>(null)
  const [faultLoading, setFaultLoading] = useState(false)
  const [productionByGw, setProductionByGw] = useState<ProductionByGwResponse | null>(null)
  const [productionLoading, setProductionLoading] = useState(false)

  const showStatus = (message: string) => {

    setStatusMessage(message)
  }

  const resetDeviceDraft = useCallback(() => {
    setDeviceDraft(EMPTY_DEVICE_FORM)
  }, [])

  const loadDeviceIntoDraft = useCallback((device: DeviceConnection) => {
    setDeviceDraft({
      id: device.id,
      name: device.name,
      driverKind: device.driverKind,
      endpointUrl: device.endpointUrl,
      securityMode: device.securityMode,
      securityPolicy: device.securityPolicy,
      authMode: device.authMode,
      username: device.username ?? '',
      password: '',
      autoConnect: device.autoConnect,
    })
  }, [])

  // 从服务器加载配方列表
  const loadRecipes = async () => {
    try {
      const [djRecipes, qyjRecipes] = await Promise.all([
        getRecipes('DJ'),
        getRecipes('QYJ'),
      ])
      setDjRecipeFiles(djRecipes.map(r => ({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })))
      setQyjRecipeFiles(qyjRecipes.map(r => ({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })))
    } catch (error) {
      console.error('加载配方列表失败:', error)
      showStatus('加载配方列表失败')
    }
  }

  // 组件挂载时加载配方列表
  useEffect(() => {
    void loadRecipes()
  }, [])

  const loadEfficiencyTimeline = useCallback(async (options?: { silent?: boolean }) => {
    if (efficiencyRequestPendingRef.current) return

    const silent = options?.silent ?? false

    try {
      efficiencyRequestPendingRef.current = true
      if (!silent) {
        setEfficiencyLoading(true)
      }

      const response = await getEfficiencyTimeline(12, stationCount)
      setEfficiencyTimeline(response)

      if (!silent) {
        setStatusMessage('效率分析数据已刷新')
      }

    } catch (error) {
      if (!silent) {
        setStatusMessage(error instanceof Error ? error.message : '效率分析刷新失败')
      }
    } finally {
      if (!silent) {
        setEfficiencyLoading(false)
      }

      efficiencyRequestPendingRef.current = false
    }
  }, [stationCount])

  const loadProductionByGw = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false

    try {
      if (!silent) {
        setProductionLoading(true)
      }

      const response = await getProductionTodayByGw()
      setProductionByGw(response)
      if (!silent) {
        setStatusMessage('产量统计数据已刷新')
      }
    } catch (error) {
      if (!silent) {
        setStatusMessage(error instanceof Error ? error.message : '产量统计刷新失败')
      }
    } finally {
      if (!silent) {
        setProductionLoading(false)
      }
    }
  }, [])

  const loadFaultByGw = useCallback(async (options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false

    try {
      if (!silent) {
        setFaultLoading(true)
      }

      const response = await getFaultTodayByGw()
      setFaultByGw(response)
      if (!silent) {
        setStatusMessage('故障分析数据已刷新')
      }
    } catch (error) {
      if (!silent) {
        setStatusMessage(error instanceof Error ? error.message : '故障分析刷新失败')
      }
    } finally {
      if (!silent) {
        setFaultLoading(false)
      }
    }
  }, [])

  const handleLookupRework = useCallback(async (tm: string): Promise<ReworkLookupResponse> => {
    const response = await getLatestReworkByTm(tm)
    setStatusMessage(response.found ? '返修记录查询完成' : '未找到匹配的返修记录')
    return response
  }, [])

  const handleLoadReworkHistory = useCallback(async (tm: string): Promise<ReworkHistoryResponse> => {
    return getReworkHistoryByTm(tm)
  }, [])

  const handleQueryRepairRecords = useCallback(async (from: string, to: string): Promise<RepairRecordListResponse> => {
    const response = await getRepairRecords(from, to)
    setStatusMessage(`返修记录查询完成：${response.items.length} 条`)
    return response
  }, [])

  const handleQueryRepairDaily = useCallback(async (months = 12): Promise<RepairRecordDailyResponse> => {
    return getRepairRecordDaily(months)
  }, [])

  // 处理保存DJ配方

  const handleSaveDJRecipe = async (recipeName: string, recipeData: Record<string, string>) => {
    const trimmedRecipeName = recipeName.trim()
    if (!trimmedRecipeName) {
      showStatus('请输入配方名')
      return false
    }

    const existingRecipe = djRecipeFiles.find((f) => f.name === trimmedRecipeName)

    try {
      if (existingRecipe) {
        await updateRecipe(existingRecipe.id, {
          name: trimmedRecipeName,
          description: '',
          items: recipeData,
        })
        showStatus(`配方 "${trimmedRecipeName}" 已更新`)
      } else {
        await createRecipe({
          name: trimmedRecipeName,
          description: '',
          recipeType: 'DJ',
          items: recipeData,
        })
        showStatus(`配方 "${trimmedRecipeName}" 已保存`)
      }

      await loadRecipes()
      setDjLoadedRecipeName(trimmedRecipeName)

      if (activeRecipeNameTag?.id && activeRecipeNameTag.allowWrite) {
        await handleWrite(activeRecipeNameTag.id, trimmedRecipeName, { successMessage: null })
      }

      return true

    } catch (error) {
      console.error('保存配方失败:', error)
      showStatus(`保存配方失败: ${error instanceof Error ? error.message : '未知错误'}`)
      return false
    }
  }


  // 处理保存QYJ配方
  const handleSaveQYJRecipe = async (recipeName: string, recipeData: Record<string, string>) => {
    const trimmedRecipeName = recipeName.trim()
    if (!trimmedRecipeName) {
      showStatus('请输入配方名')
      return false
    }

    const existingRecipe = qyjRecipeFiles.find((f) => f.name === trimmedRecipeName)

    try {
      if (existingRecipe) {
        await updateRecipe(existingRecipe.id, {
          name: trimmedRecipeName,
          description: '',
          items: recipeData,
        })
        showStatus(`配方 "${trimmedRecipeName}" 已更新`)
      } else {
        await createRecipe({
          name: trimmedRecipeName,
          description: '',
          recipeType: 'QYJ',
          items: recipeData,
        })
        showStatus(`配方 "${trimmedRecipeName}" 已保存`)
      }

      await loadRecipes()
      setQyjLoadedRecipeName(trimmedRecipeName)

      if (activeRecipeNameTag?.id && activeRecipeNameTag.allowWrite) {
        await handleWrite(activeRecipeNameTag.id, trimmedRecipeName, { successMessage: null })
      }

      return true

    } catch (error) {
      console.error('保存配方失败:', error)
      showStatus(`保存配方失败: ${error instanceof Error ? error.message : '未知错误'}`)
      return false
    }
  }


  // 处理加载DJ配方
  const handleLoadDJRecipe = async (fileId: string) => {
    const file = djRecipeFiles.find((f) => f.id === fileId)
    if (!file) {
      showStatus('配方文件不存在')
      return false
    }

    try {
      const detail = await getRecipe(fileId)
      let successCount = 0
      let failedCount = 0

      for (const [recipeItemKey, value] of Object.entries(detail.items)) {
        const targetTag = resolveRecipeItemTag(runtime.tags, recipeItemKey)
        if (!targetTag) {
          failedCount += 1
          continue
        }
        if (targetTag.id === activeRecipeNameTag?.id) continue
        const succeeded = await handleWrite(targetTag.id, value, { successMessage: null })
        if (succeeded) successCount += 1
        else failedCount += 1
      }

      setDjLoadedRecipeName(file.name)
      if (activeRecipeNameTag?.id && activeRecipeNameTag.allowWrite) {
        const nameWriteSucceeded = await handleWrite(activeRecipeNameTag.id, file.name, { successMessage: null })
        if (!nameWriteSucceeded) {
          failedCount += 1
        }
      }

      if (failedCount > 0) {
        showStatus(`配方 "${file.name}" 加载完成，但有 ${failedCount} 项写入失败`)
        return false
      }

      showStatus(`配方 "${file.name}" 已加载，成功写入 ${successCount} 项`)
      return true

    } catch (error) {
      console.error('加载配方失败:', error)
      showStatus(`加载配方失败: ${error instanceof Error ? error.message : '未知错误'}`)
      return false
    }
  }


  // 处理加载QYJ配方
  const handleLoadQYJRecipe = async (fileId: string) => {
    const file = qyjRecipeFiles.find((f) => f.id === fileId)
    if (!file) {
      showStatus('配方文件不存在')
      return false
    }

    try {
      const detail = await getRecipe(fileId)
      let successCount = 0
      let failedCount = 0

      for (const [recipeItemKey, value] of Object.entries(detail.items)) {
        const targetTag = resolveRecipeItemTag(runtime.tags, recipeItemKey)
        if (!targetTag) {
          failedCount += 1
          continue
        }
        if (targetTag.id === activeRecipeNameTag?.id) continue
        const succeeded = await handleWrite(targetTag.id, value, { successMessage: null })
        if (succeeded) successCount += 1
        else failedCount += 1
      }

      setQyjLoadedRecipeName(file.name)
      if (activeRecipeNameTag?.id && activeRecipeNameTag.allowWrite) {
        const nameWriteSucceeded = await handleWrite(activeRecipeNameTag.id, file.name, { successMessage: null })
        if (!nameWriteSucceeded) {
          failedCount += 1
        }
      }

      if (failedCount > 0) {
        showStatus(`配方 "${file.name}" 加载完成，但有 ${failedCount} 项写入失败`)
        return false
      }

      showStatus(`配方 "${file.name}" 已加载，成功写入 ${successCount} 项`)
      return true
    } catch (error) {
      console.error('加载配方失败:', error)
      showStatus(`加载配方失败: ${error instanceof Error ? error.message : '未知错误'}`)
      return false
    }
  }



  // 处理删除DJ配方
  const handleDeleteDJRecipe = async (fileId: string) => {
    const file = djRecipeFiles.find((f) => f.id === fileId)
    if (!file) {
      showStatus('配方文件不存在，删除失败')
      return false
    }

    try {
      await deleteRecipe(fileId)
      await loadRecipes()
      if (djLoadedRecipeName === file.name) {
        setDjLoadedRecipeName('')
      }
      showStatus(`配方 "${file.name}" 已删除`)
      return true
    } catch (error) {
      console.error('删除配方失败:', error)
      showStatus(`删除配方失败: ${error instanceof Error ? error.message : '未知错误'}`)
      return false
    }
  }

  // 处理删除QYJ配方
  const handleDeleteQYJRecipe = async (fileId: string) => {
    const file = qyjRecipeFiles.find((f) => f.id === fileId)
    if (!file) {
      showStatus('配方文件不存在，删除失败')
      return false
    }

    try {
      await deleteRecipe(fileId)
      await loadRecipes()
      if (qyjLoadedRecipeName === file.name) {
        setQyjLoadedRecipeName('')
      }
      showStatus(`配方 "${file.name}" 已删除`)
      return true
    } catch (error) {
      console.error('删除配方失败:', error)
      showStatus(`删除配方失败: ${error instanceof Error ? error.message : '未知错误'}`)
      return false
    }
  }


  const sidebarItems = useMemo(() => {
    const visibleBaseSidebarItems = baseSidebarItems.filter((item) => {
      if (!MENU_VISIBILITY_KEYS.includes(item.key as MenuVisibilityKey)) return true
      return reportVisibility[item.key as MenuVisibilityKey] ?? true
    })
    return isAuthenticated ? [...visibleBaseSidebarItems, ...protectedSidebarItems] : visibleBaseSidebarItems
  }, [isAuthenticated, reportVisibility])
  const reportConfigItems = [
    ...REPORT_SERVICE_KEYS.map((key) => ({
      key,
      title: REPORTS[key].title,
      subtitle: REPORTS[key].subtitle,
      visible: reportVisibility[key],
    })),
    { key: 'rework' as const, title: '返修管理', subtitle: '返修服务页面入口', visible: reportVisibility.rework },
    { key: 'reworkConfig' as const, title: '返修组态', subtitle: '返修服务页面入口', visible: reportVisibility.reworkConfig },
    { key: 'reworkRecords' as const, title: '返修记录', subtitle: '返修服务页面入口', visible: reportVisibility.reworkRecords },
  ]
  const groups = useMemo(() => {
    const values = runtime.tags.map((tag) => getResolvedGroup(runtimeNameById[tag.deviceId] ?? '', tag))
    return sortGroupOptions(values)
  }, [runtime.tags, runtimeNameById])

  function parseDashboardFieldFromName(value: string) {
    const trimmed = value.trim()
    if (!trimmed) return null

    const barcodeMatch = /^hmi_db\.barcode\[(\d+)\]$/i.exec(trimmed)
    if (barcodeMatch) {
      return { templateIndex: Number(barcodeMatch[1]), fieldKey: 'barcode' }
    }

    const faceplateMatch = /^hmi_db\.(?:hmi_faceplates|faceplates)\[(\d+)\]\.([a-z0-9_]+)$/i.exec(trimmed)
    if (!faceplateMatch) return null
    return { templateIndex: Number(faceplateMatch[1]), fieldKey: faceplateMatch[2].toLowerCase() }
  }

  function parseDashboardTemplateField(tag: TagDefinition) {
    const candidates = [tag.displayName, tag.browseName, getDisplayName(tag.nodeId)]
      .map((item) => (item ?? '').trim())
      .filter(Boolean)

    for (const candidate of candidates) {
      const parsed = parseDashboardFieldFromName(candidate)
      if (parsed) return parsed
    }

    return null
  }

  const dashboardTagMapByFaceplate = useMemo(() => {
    const fieldSet = new Set<string>(DASHBOARD_TEMPLATE_FIELDS)
    const indexSet = new Set<number>(dashboardFaceplateIndexes)
    const result: Record<number, Map<string, TagDefinition>> = {}

    for (const index of dashboardFaceplateIndexes) {
      result[index] = new Map<string, TagDefinition>()
    }

    for (const tag of runtime.tags) {
      if (isLocalVariableTag(tag)) continue
      const parsed = parseDashboardTemplateField(tag)
      if (!parsed) continue
      if (!indexSet.has(parsed.templateIndex)) continue
      if (!fieldSet.has(parsed.fieldKey)) continue
      result[parsed.templateIndex].set(parsed.fieldKey, tag)
    }

    return result
  }, [dashboardFaceplateIndexes, runtime.tags])

  const dashboardTagsByFaceplate = useMemo(() => {
    const result: Record<number, TagDefinition[]> = {}
    for (const index of dashboardFaceplateIndexes) {
      result[index] = Array.from(dashboardTagMapByFaceplate[index]?.values() ?? [])
    }
    return result
  }, [dashboardFaceplateIndexes, dashboardTagMapByFaceplate])

  useEffect(() => {
    dashboardTagMapByFaceplateRef.current = dashboardTagMapByFaceplate
  }, [dashboardTagMapByFaceplate])

  useEffect(() => {
    snapshotByTagIdRef.current = snapshotByTagId
  }, [snapshotByTagId])

  useEffect(() => {
    runtimeDeviceStatusByIdRef.current = runtimeDeviceStatusById
  }, [runtimeDeviceStatusById])

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = Date.now()
      setDashboardTrendByFaceplate((current) => {
        const next: Record<number, FaceplateTrend> = { ...current }
        for (const index of dashboardFaceplateIndexes) {
          const map = dashboardTagMapByFaceplateRef.current[index]
          if (!map) continue
          const pressureTag = map.get('pressure')
          const flowTag = map.get('flow')
          if (!pressureTag && !flowTag) continue

          const trend = current[index] ?? { pressure: [], flow: [] }
          const pressureSnapshot = pressureTag ? snapshotByTagIdRef.current.get(pressureTag.id) : undefined
          const flowSnapshot = flowTag ? snapshotByTagIdRef.current.get(flowTag.id) : undefined
          const pressureHealthy = pressureTag
            ? isHealthySnapshot(pressureTag, pressureSnapshot, runtimeDeviceStatusByIdRef.current[pressureTag.deviceId])
            : false
          const flowHealthy = flowTag
            ? isHealthySnapshot(flowTag, flowSnapshot, runtimeDeviceStatusByIdRef.current[flowTag.deviceId])
            : false
          const pressureValue = pressureHealthy ? toNumericValue(pressureSnapshot?.value ?? null) : null
          const flowValue = flowHealthy ? toNumericValue(flowSnapshot?.value ?? null) : null
          if (pressureValue === null && flowValue === null) continue

          const keepAfter = now - 120_000

          next[index] = {
            pressure: (pressureValue === null
              ? trend.pressure
              : [...trend.pressure, { ts: now, value: pressureValue }]).filter((item) => item.ts >= keepAfter),
            flow: (flowValue === null
              ? trend.flow
              : [...trend.flow, { ts: now, value: flowValue }]).filter((item) => item.ts >= keepAfter),
          }
        }
        return next
      })
    }, 500)
    return () => window.clearInterval(timer)
  }, [dashboardFaceplateIndexes])

  function dashboardField(faceplateIndex: number, name: string): DashboardField {
    const tagMap = dashboardTagMapByFaceplate[faceplateIndex]
    const tag = tagMap.get(name.toLowerCase())
    const key = name.toLowerCase()
    const digitsMap: Record<string, number> = {
      voltage: 1,
      current: 2,
      pressure: 2,
      inletpressure: 1,
      flow: 1,
      power: 0,
    }
    const snapshot = tag ? snapshotByTagId.get(tag.id) : undefined
    const deviceStatus = tag ? runtimeDeviceStatusById[tag.deviceId] : undefined
    const healthy = tag ? isHealthySnapshot(tag, snapshot, deviceStatus) : false
    const numeric = healthy ? toNumericValue(snapshot?.value ?? null) : null
    const emptyText = formatNumberWithUnit(null, inferUnit(name), digitsMap[key])
    return {
      tag,
      snapshot,
      healthy,
      numeric,
      text: healthy ? formatNumberWithUnit(numeric, inferUnit(name), digitsMap[key]) : emptyText,
      emptyText,
    }
  }

  const dashboardDataList = useMemo(() => {
    return dashboardFaceplateIndexes.map((faceplateIndex) => {
    const pressure = dashboardField(faceplateIndex, 'pressure')
    const flow = dashboardField(faceplateIndex, 'flow')
    const inletPressure = dashboardField(faceplateIndex, 'inletpressure')
    const inletTemp = dashboardField(faceplateIndex, 'inlettemp')
    const voltage = dashboardField(faceplateIndex, 'voltage')
    const current = dashboardField(faceplateIndex, 'current')
    const frequency = dashboardField(faceplateIndex, 'frequency')
    const power = dashboardField(faceplateIndex, 'power')
    const passNumber = dashboardField(faceplateIndex, 'passnumber')
    const failNumber = dashboardField(faceplateIndex, 'failnumber')
    const errCode = dashboardField(faceplateIndex, 'errcode')
    const workFlow = dashboardField(faceplateIndex, 'workflow')
    const enduranceProcess = dashboardField(faceplateIndex, 'enduranceprocess')
    const triggerOn = dashboardField(faceplateIndex, 'triggeronprocess')
    const triggerOff = dashboardField(faceplateIndex, 'triggeroffprocess')
    const triggerCount = dashboardField(faceplateIndex, 'triggercount')
    const lastTimeHour = dashboardField(faceplateIndex, 'lasttimehour')
    const lastTimeMinute = dashboardField(faceplateIndex, 'lasttimeminute')
    const stationNumber = dashboardField(faceplateIndex, 'stationnumber')
    const barcode = dashboardField(faceplateIndex, 'barcode')
    const now = Date.now()
    const faceplateTrend = dashboardTrendByFaceplate[faceplateIndex] ?? { pressure: [], flow: [] }
    const pressureSeries = faceplateTrend.pressure.length > 0
      ? faceplateTrend.pressure
      : pressure.numeric !== null
        ? [{ ts: now, value: pressure.numeric }]
        : []
    const flowSeries = faceplateTrend.flow.length > 0
      ? faceplateTrend.flow
      : flow.numeric !== null
        ? [{ ts: now, value: flow.numeric }]
        : []
    const endurancePercent = Math.max(0, Math.min(100, Math.round(enduranceProcess.numeric ?? 0)))
    const triggerOnPercent = Math.max(0, Math.min(100, Math.round(triggerOn.numeric ?? 0)))
    const triggerOffPercent = Math.max(0, Math.min(100, Math.round(triggerOff.numeric ?? 0)))
    const factoryTotal = (passNumber.numeric ?? 0) + (failNumber.numeric ?? 0)
    const passPercent = factoryTotal > 0 ? Math.round(((passNumber.numeric ?? 0) / factoryTotal) * 100) : 0
    const failPercent = factoryTotal > 0 ? Math.round(((failNumber.numeric ?? 0) / factoryTotal) * 100) : 0
    const errCodeRaw = toNumericValue(errCode.snapshot?.value ?? null)
    const workflowRaw = toNumericValue(workFlow.snapshot?.value ?? null)
    const status = errCodeToStatus(Math.round(errCodeRaw ?? 0))
    const workflowValue = Math.round(workflowRaw ?? 0)
    const workflowText = workflowToLabel(workflowValue)
    const workflowClass = workflowValue === 0 ? 'standby' : 'running'
    const enduranceMode = dashboardField(faceplateIndex, 'automode0_factory1_endurance')
    const showEnduranceCard = Math.round(enduranceMode.numeric ?? 0) > 0
    const enduranceDuration = `${Math.max(0, lastTimeHour.numeric ?? 0)}h ${Math.max(0, lastTimeMinute.numeric ?? 0)}min`
    const faceplateTags = dashboardTagsByFaceplate[faceplateIndex] ?? []
    const hasConnectedDevice = faceplateTags.some((tag) => (runtimeDeviceStatusById[tag.deviceId] ?? '').toLowerCase() === 'connected')
    const hasGoodSnapshot = faceplateTags.some((tag) => {
      const snapshot = snapshotByTagId.get(tag.id)
      const deviceStatus = runtimeDeviceStatusById[tag.deviceId]
      return isHealthySnapshot(tag, snapshot, deviceStatus)
    })
    const faceplateDeviceStatuses = Array.from(
      new Set(faceplateTags.map((tag) => (runtimeDeviceStatusById[tag.deviceId] ?? '').toLowerCase()).filter((value) => value !== '')),
    )
    const hasDeviceDisconnecting = faceplateDeviceStatuses.some((status) =>
      status.includes('reconnect') || status.includes('disconnect') || status.includes('offline') || status.includes('fault') || status.includes('error'),
    )
    const connected = hasConnectedDevice && !hasDeviceDisconnecting && hasGoodSnapshot
    const boardHeadClass =
      !connected
        ? 'disconnected'
        : (errCodeRaw ?? 0) > 0
          ? 'fault'
          : (workflowRaw ?? 0) > 0
            ? 'connected'
            : 'standby'
    const noDataText = '-'
    const maskField = (field: DashboardField): DashboardField =>
      connected ? field : { ...field, healthy: false, numeric: null, text: field.emptyText }
    const safeStatus = connected ? status : { text: noDataText, className: 'fault' as const }

    return {
      faceplateIndex,
      available: (dashboardTagsByFaceplate[faceplateIndex] ?? []).length > 0,
      title: stationNumber.numeric !== null ? `工位${stationNumber.numeric}` : `工位${faceplateIndex}`,
      stationText:
        connected
          ? (
              barcode.snapshot?.value === null || barcode.snapshot?.value === undefined
                ? '-'
                : String(barcode.snapshot.value).trim() || '-'
            )
          : noDataText,
      deviceStatus: connected ? `Connected / ${status.text}` : 'Disconnected',
      boardHeadClass,
      risk: { label: safeStatus.className === 'normal' ? '正常' : '异常', className: safeStatus.className },
      statusText: safeStatus.text,
      workflowText: connected ? workflowText : noDataText,
      workflowClass,
      pressure: maskField(pressure),
      flow: maskField(flow),
      inletPressure: maskField(inletPressure),
      inletTemp: maskField(inletTemp),
      voltage: maskField(voltage),
      current: maskField(current),
      frequency: maskField(frequency),
      power: maskField(power),
      passNumber: maskField(passNumber),
      failNumber: maskField(failNumber),
      errCode: maskField(errCode),
      enduranceProcess: maskField(enduranceProcess),
      triggerOn: maskField(triggerOn),
      triggerOff: maskField(triggerOff),
      triggerCount: maskField(triggerCount),
      pressureSeries,
      flowSeries,
      endurancePercent: connected ? endurancePercent : 0,
      passPercent: connected ? passPercent : 0,
      failPercent: connected ? failPercent : 0,
      showEnduranceCard: connected ? showEnduranceCard : false,
      enduranceDuration: connected ? enduranceDuration : noDataText,
      triggerOnPercent: connected ? triggerOnPercent : 0,
      triggerOffPercent: connected ? triggerOffPercent : 0,
      passCountText: connected ? formatCount(passNumber.numeric) : noDataText,
      failCountText: connected ? formatCount(failNumber.numeric) : noDataText,
    }
  })
  }, [dashboardFaceplateIndexes, dashboardTagsByFaceplate, dashboardTrendByFaceplate, runtimeDeviceStatusById, snapshotByTagId])

  const liveEfficiencyStateByFaceplate = useMemo(() => {
    return dashboardDataList.reduce<Partial<Record<number, { stateKey: 'disconnected' | 'standby' | 'running' | 'fault'; stateLabel: string; colorHex: string }>>>((acc, item) => {
      if (item.boardHeadClass === 'fault') {
        acc[item.faceplateIndex] = { stateKey: 'fault', stateLabel: '报警', colorHex: '#ca3333' }
      } else if (item.boardHeadClass === 'connected') {
        acc[item.faceplateIndex] = { stateKey: 'running', stateLabel: '测试中', colorHex: '#2eaa4a' }
      } else if (item.boardHeadClass === 'standby') {
        acc[item.faceplateIndex] = { stateKey: 'standby', stateLabel: '待机', colorHex: '#eace21' }
      } else {
        acc[item.faceplateIndex] = { stateKey: 'disconnected', stateLabel: '未工作', colorHex: '#dadce0' }
      }
      return acc
    }, {})
  }, [dashboardDataList])

  const dashboardSyncTargets = useMemo(() => {
    return dashboardFaceplateIndexes.map((faceplateIndex) => {
      const board = dashboardDataList.find((item) => item.faceplateIndex === faceplateIndex)
      const recipeNameTag = runtime.tags.find((tag) => isExactRecipeDbRecipeNameTag(tag, faceplateIndex)) ?? null
      const recipeNameTagHealthy = recipeNameTag
        ? statusOf(recipeNameTag, snapshotByTagId.get(recipeNameTag.id), runtimeDeviceStatusById[recipeNameTag.deviceId]).className === 'normal'
        : false

      return {
        index: faceplateIndex,
        visible: true,
        disabled: !recipeNameTagHealthy,
        label: board?.title ?? `工位${faceplateIndex}`,
      }
    })
  }, [dashboardDataList, dashboardFaceplateIndexes, runtime.tags, runtimeDeviceStatusById, snapshotByTagId])


  const filteredRuntimeTags = useMemo(() => {
    const tags = runtime.tags.filter((tag) => {
      const group = getResolvedGroup(runtimeNameById[tag.deviceId] ?? '', tag)
      return groupFilter === 'all' || group === groupFilter
    })

    return [...tags].sort((left, right) => {
      const leftName = (left.displayName || left.browseName || getDisplayName(left.nodeId)).trim()
      const rightName = (right.displayName || right.browseName || getDisplayName(right.nodeId)).trim()
      const nameCompare = leftName.localeCompare(rightName, 'zh-CN', { numeric: true, sensitivity: 'base' })
      if (nameCompare !== 0) return nameCompare

      return left.nodeId.localeCompare(right.nodeId, 'zh-CN', { numeric: true, sensitivity: 'base' })
    })
  }, [groupFilter, runtime.tags, runtimeNameById])

  const runtimeRows = useMemo(() => {
    return filteredRuntimeTags.map((tag, index) => {
      const snapshot = snapshotByTagId.get(tag.id)
      const deviceStatus = runtimeDeviceStatusById[tag.deviceId]
      const stat = statusOf(tag, snapshot, deviceStatus)
      const group = getResolvedGroup(runtimeNameById[tag.deviceId] ?? '', tag)
      const healthyValue = formatValue(tag, snapshot, deviceStatus)
      return {
        risk: index + 1,
        tag,
        snapshot,
        stat,
        group,
        healthyValue,
        time: compactTimeText(snapshot),
      }
    })
  }, [filteredRuntimeTags, runtimeDeviceStatusById, runtimeNameById, snapshotByTagId])

  const recipeRows = useMemo(() => {
    const source = runtime.tags.filter((tag) => isLocalRecipeScopedTag(tag) && detectLocalRecipeType(tag, activeRecipeType) === activeRecipeType)


    return source.map((tag, index) => {
      const snapshot = snapshotByTagId.get(tag.id)
      const deviceStatus = runtimeDeviceStatusById[tag.deviceId]
      const stat = statusOf(tag, snapshot, deviceStatus)
      const group = getResolvedGroup(runtimeNameById[tag.deviceId] ?? '', tag)
      const currentValue = stat.className === 'normal' ? formatValue(tag, snapshot, deviceStatus) : '暂无数据'
      return {
        index: index + 1,
        tag,
        stat,
        group,
        currentValue,
        time: compactTimeText(snapshot),
      }
    })
  }, [activeRecipeType, runtime.tags, runtimeDeviceStatusById, runtimeNameById, snapshotByTagId])

  const activeRecipeNameTag = useMemo(() => {
    const primary = runtime.tags.find((tag) => isPrimaryLocalRecipeNameTag(tag))
    if (primary) return primary

    return runtime.tags.find((tag) => isLocalRecipeNameTag(tag)) ?? null
  }, [runtime.tags])

  const deviceStatusCards = useMemo(() => {

    return runtime.devices.map((runtimeDevice) => {
      const device = devices.find((d) => d.id === runtimeDevice.deviceId)
      const runtimeStatus = runtimeDevice.status
      const deviceTags = runtime.tags.filter((tag) => tag.deviceId === runtimeDevice.deviceId)
      let hasSnapshot = false
      let hasBadSnapshot = false

      for (const tag of deviceTags) {
        if (isLocalVariableTag(tag)) continue

        const snapshot = snapshotByTagId.get(tag.id)
        if (!snapshot) continue
        hasSnapshot = true
        if (statusOf(tag, snapshot, runtimeStatus).className !== 'normal') {
          hasBadSnapshot = true
          break
        }
      }

      const display = resolveDeviceConnectionDisplay(runtimeStatus, hasBadSnapshot, hasSnapshot)
      return {
        id: runtimeDevice.deviceId,
        name: runtimeDevice.deviceName,
        endpointUrl: device?.endpointUrl ?? runtimeDevice.endpointUrl,
        autoConnect: device?.autoConnect ?? false,
        updatedAt: device?.updatedAt,
        statusLabel: display.label,
        statusClassName: display.className,
        statusDetail: display.detail,
      }
    })
  }, [devices, runtime.devices, runtime.tags, runtimeDeviceStatusById, snapshotByTagId])

  const onlineDeviceCount = useMemo(
    () => deviceStatusCards.filter((item) => item.statusClassName === 'normal').length,
    [deviceStatusCards],
  )

  async function openVnc(faceplateIndex: number) {
    const hostByFaceplate: Record<number, string> = {
      1: '192.168.88.11',
      2: '192.168.88.12',
    }
    const host = hostByFaceplate[faceplateIndex]
    if (!host) return
    try {
      const result = await openVncTool(host)
      setStatusMessage(result.message || `已尝试打开 RealVNC: ${host}:5900`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : `打开 RealVNC 失败: ${host}:5900`)
    }
  }

  async function loadWorkspace() {
    try {
      setLoading(true)
      const [overview, deviceList, tags] = await Promise.all([getRuntimeOverview(), getDevices(), getTags()])
      setRuntime(overview)
      setDevices(deviceList)
      setTagRows(tags)
      if (!selectedDeviceId && deviceList[0]) setSelectedDeviceId(deviceList[0].id)
      setStatusMessage('数据已刷新')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }

  async function refreshRuntime() {
    try {
      setLoading(true)
      const overview = await getRuntimeOverview()
      setRuntime(overview)
      setStatusMessage('监控数据已刷新')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '刷新失败')
    } finally {
      setLoading(false)
    }
  }

  async function loadBrowse(deviceId: string, nodeId: string | null, force = false) {
    if (!deviceId) return
    const key = `${deviceId}|${nodeId ?? '__root__'}`
    if (!force && (browseLoadingKeys[key] || Object.prototype.hasOwnProperty.call(browseCache, key))) return

    try {
      setBrowseLoadingKeys((current) => ({ ...current, [key]: true }))
      const nodes = await browseDevice(deviceId, nodeId ?? undefined)
      setBrowseCache((current) => ({ ...current, [key]: nodes }))
    } catch (error) {
      setBrowseCache((current) => {
        if (!Object.prototype.hasOwnProperty.call(current, key)) return current
        const next = { ...current }
        delete next[key]
        return next
      })
      setStatusMessage(error instanceof Error ? error.message : '浏览目录失败')
    } finally {
      setBrowseLoadingKeys((current) => {
        if (!current[key]) return current
        const next = { ...current }
        delete next[key]
        return next
      })
    }
  }

  async function handleSaveDevice() {
    if (!deviceDraft.name.trim()) {
      setStatusMessage('请输入设备名称')
      return
    }

    if (!deviceDraft.endpointUrl.trim()) {
      setStatusMessage(isSiemensDraft ? '请输入 PLC 地址或 Webserver 地址' : '请输入 OPC UA Endpoint URL')
      return
    }

    try {
      setSavingDevice(true)
      if (deviceDraft.id) {
        await updateDevice(deviceDraft.id, deviceDraft)
        setStatusMessage(`设备 "${deviceDraft.name}" 已更新`)
      } else {
        await createDevice(deviceDraft)
        setStatusMessage(`设备 "${deviceDraft.name}" 已创建`)
      }

      await loadWorkspace()
      resetDeviceDraft()
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '保存设备失败')
    } finally {
      setSavingDevice(false)
    }
  }

  async function handleDeleteDevice() {
    if (!deviceDraft.id) {
      setStatusMessage('请先选择要删除的设备')
      return
    }

    if (deviceDraft.name.trim().toLowerCase() === 'local') {
      setStatusMessage('Local 设备不能删除')
      return
    }

    if (!window.confirm(`确认删除设备 "${deviceDraft.name}" 吗？`)) {
      return
    }

    try {
      setSavingDevice(true)
      await deleteDevice(deviceDraft.id)
      await loadWorkspace()
      resetDeviceDraft()
      setSelectedDeviceId('')
      setStatusMessage(`设备 "${deviceDraft.name}" 已删除`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '删除设备失败')
    } finally {
      setSavingDevice(false)
    }
  }

  async function handleConnectSelectedDevice() {
    if (!selectedDevice) {
      setStatusMessage('请先选择设备')
      return
    }

    try {
      await connectDevice(selectedDevice.id)
      await loadWorkspace()
      setStatusMessage(`设备 "${selectedDevice.name}" 已发起连接`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '连接设备失败')
    }
  }

  async function handleDisconnectSelectedDevice() {
    if (!selectedDevice) {
      setStatusMessage('请先选择设备')
      return
    }

    try {
      await disconnectDevice(selectedDevice.id)
      await loadWorkspace()
      setStatusMessage(`设备 "${selectedDevice.name}" 已断开`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '断开设备失败')
    }
  }

  useEffect(() => { void loadWorkspace() }, [])

  useEffect(() => {
    if (view !== 'efficiency') return

    void loadEfficiencyTimeline()
    const timer = window.setInterval(() => {
      void loadEfficiencyTimeline({ silent: true })
    }, 5000)

    return () => window.clearInterval(timer)
  }, [loadEfficiencyTimeline, view])

  useEffect(() => {
    if (view !== 'production') return

    void loadProductionByGw()
    const timer = window.setInterval(() => {
      void loadProductionByGw({ silent: true })
    }, 10000)

    return () => window.clearInterval(timer)
  }, [loadProductionByGw, view])

  useEffect(() => {
    if (view !== 'fault') return

    void loadFaultByGw()
    const timer = window.setInterval(() => {
      void loadFaultByGw({ silent: true })
    }, 10000)

    return () => window.clearInterval(timer)
  }, [loadFaultByGw, view])

  useEffect(() => {
    const connection = new HubConnectionBuilder().withUrl('/hubs/realtime').withAutomaticReconnect().configureLogging(LogLevel.Information).build()

    connection.on('tagSnapshotUpdated', (snapshot: TagSnapshot) => {
      setRuntime((current) => ({ ...current, snapshots: [...current.snapshots.filter((item) => item.tagId !== snapshot.tagId), snapshot] }))
    })
    connection.on('deviceStatusChanged', (event: { deviceId: string; status: string; message: string }) => {
      setRuntime((current) => ({ ...current, devices: current.devices.map((device) => (device.deviceId === event.deviceId ? { ...device, status: event.status } : device)) }))
      setStatusMessage(event.message || '设备状态已更新')
    })
    void connection.start().catch(() => setStatusMessage('实时连接未建立，当前显示缓存数据'))
    return () => { void connection.stop() }
  }, [])

  useEffect(() => { if (!selectedDeviceId && activeDeviceId) setSelectedDeviceId(activeDeviceId) }, [activeDeviceId, selectedDeviceId])
  useEffect(() => { setSelectedTagGroupFilter('all') }, [activeDeviceId])
  useEffect(() => {
    if (!isAuthenticated && (view === 'runtime' || view === 'tags' || view === 'reportConfig')) {
      setView('login')
      setStatusMessage('请先登录后再访问标签、订阅或报表配置页面')
    }
  }, [isAuthenticated, view])
  useEffect(() => {
    const previousView = previousViewRef.current
    previousViewRef.current = view
    if (view === 'login' && previousView !== 'login' && !isAuthenticated) {
      setLoginUsername('')
      setLoginPassword('')
    }
  }, [isAuthenticated, view])
  useEffect(() => {
    try {
      window.localStorage.setItem(REPORT_VISIBILITY_STORAGE_KEY, JSON.stringify(reportVisibility))
    } catch {
      // ignore storage errors
    }
  }, [reportVisibility])

  useEffect(() => {
    try {
      window.localStorage.setItem(STATION_COUNT_STORAGE_KEY, String(stationCount))
    } catch {
      // ignore storage errors
    }
  }, [stationCount])
  useEffect(() => {
    const currentReportKey = view as ReportKey
    if (!MENU_VISIBILITY_KEYS.includes(currentReportKey as MenuVisibilityKey)) return
    if (reportVisibility[currentReportKey] !== false) return
    setView('dashboard')
    setStatusMessage('当前报表已在报表配置中隐藏')
  }, [reportVisibility, view])

  useEffect(() => {
    if (!activeDeviceId || activeDeviceId === LOCAL_DEVICE_ID) return
    setExpandedBrowseNodes({})
    setSelectedBrowseNodes([])
    if (isSiemensDevice) return
    void loadBrowse(activeDeviceId, null)
  }, [activeDeviceId, isSiemensDevice])

  function focusBatchSection() {
    setView('tags')
    window.requestAnimationFrame(() => {
      batchSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  async function handleWrite(tagId: string, value?: string, options?: WriteOptions) {
    const valueToWrite = value ?? writeDrafts[tagId]
    if (valueToWrite === undefined || valueToWrite.trim() === '') {
      setStatusMessage('请输入要写入的值')
      return false
    }

    try {
      setSavingTagId(tagId)
      await writeTag(tagId, valueToWrite)
      setWriteDrafts((current) => ({ ...current, [tagId]: '' }))

      if (options?.successMessage !== null) {
        setStatusMessage(options?.successMessage ?? '写入成功')
      }

      if (options?.refreshRuntime !== false) {
        await refreshRuntime()
      }

      return true
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '写入失败')
      return false
    } finally {
      setSavingTagId(null)
    }
  }


  function toggleFolder(node: BrowseNode) {
    setExpandedBrowseNodes((current) => {
      const nextExpanded = !current[node.nodeId]
      if (nextExpanded) void loadBrowse(activeDeviceId, node.nodeId)
      return { ...current, [node.nodeId]: nextExpanded }
    })
  }

  function toggleBrowse(node: BrowseNode) {
    if (node.hasChildren) {
      toggleFolder(node)
      return
    }

    setSelectedBrowseNodes((current) =>
      current.some((item) => item.nodeId === node.nodeId)
        ? current.filter((item) => item.nodeId !== node.nodeId)
        : [...current, node],
    )
  }

  function addSelectionToBatch() {
    if (!activeDeviceId || selectedBrowseNodes.length === 0) return setStatusMessage('请先勾选要配置的变量')
    setBatchDrafts((current) => {
      const map = new Map(current.map((item) => [item.nodeId, item]))
      for (const node of selectedBrowseNodes) map.set(node.nodeId, draftFromBrowse(activeDeviceId, activeDeviceName, node))
      return Array.from(map.values())
    })
    setSelectedBrowseNodes([])
    setStatusMessage(`已加入 ${selectedBrowseNodes.length} 个变量到批量配置`)
    focusBatchSection()
  }

  function loadDeviceTagsToBatch() {
    setBatchDrafts(selectedDeviceTags.map((tag) => draftFromTag(tag, activeDeviceName)))
    setStatusMessage(`已载入 ${selectedDeviceTags.length} 个已订阅变量`)
    focusBatchSection()
  }

  function addManualBatchAddress() {
    if (!activeDeviceId) {
      setStatusMessage('请先选择设备')
      return
    }

    setBatchDrafts((current) => [
      ...current,
      {
        deviceId: activeDeviceId,
        nodeId: '',
        browseName: '',
        displayName: '',
        dataType: 'Boolean',
        samplingIntervalMs: 200,
        publishingIntervalMs: 200,
        allowWrite: true,
        enabled: true,
        groupKey: '未分组',
      },
    ])
    setStatusMessage('已新增空白地址行，请在批量配置中填写绝对地址')
    focusBatchSection()
  }

  async function handleExportAllTagsExcel() {
    try {
      setLoading(true)
      const blob = await exportAllTagsExcel()
      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `subscription_tags_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.xlsx`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(url)
      setStatusMessage('订阅标签 Excel 已导出')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '导出 Excel 失败')
    } finally {
      setLoading(false)
    }
  }

  function handlePickImportTagsExcel() {
    importTagsFileInputRef.current?.click()
  }

  async function handleImportTagsExcel(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const confirmed = window.confirm('导入后将用 Excel 内容替换所有订阅标签，是否继续？')
    if (!confirmed) return

    try {
      setLoading(true)
      const result = await importTagsExcelReplace(file)
      await loadWorkspace()
      await refreshRuntime()
      setBatchDrafts([])
      setSelectedBrowseNodes([])
      setStatusMessage(`Excel 导入完成，已替换 ${result.created} 条标签，移除 ${result.removed} 条旧标签`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '导入 Excel 失败')
    } finally {
      setLoading(false)
    }
  }

  function clearBatchDrafts() { setBatchDrafts([]); setStatusMessage('已清空批量配置列表') }
  function applyBatchDefaults() {
    setBatchDrafts((current) => current.map((row) => {
      const groupKey = row.groupKey?.trim() || '未分组'
      const isLocal = isLocalVariableGroup(groupKey)
      const recipeRule = resolveRecipeRule(row.nodeId)
      const normalizedLocalDisplayName = normalizeLocalRecipeDisplayName(row.displayName.trim() || getDisplayName(row.nodeId) || 'Local Variable')
      const localRecipeGroup = resolveLocalRecipeGroupFromDisplay(normalizedLocalDisplayName)
      return {
        ...row,
        displayName: isLocal ? normalizedLocalDisplayName : (row.displayName.trim() || getDisplayName(row.nodeId) || 'Local Variable'),
        groupKey: isLocal ? (localRecipeGroup ?? 'Local Variable') : (recipeRule?.groupKey || groupKey),
        nodeId: isLocal ? (row.nodeId.startsWith('local://') ? row.nodeId : '') : row.nodeId,
        samplingIntervalMs: isLocal ? 0 : (recipeRule?.intervalMs || row.samplingIntervalMs || 200),
        publishingIntervalMs: isLocal ? 0 : (recipeRule?.intervalMs || row.publishingIntervalMs || 200),
        enabled: true,
      }

    }))
    setStatusMessage('默认规则已应用')
  }
  function updateBatchRow(index: number, patch: Partial<TagFormState>) { setBatchDrafts((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row))) }

  async function saveBatch() {
    if (batchRows.length === 0) return setStatusMessage('没有可保存的变量')
    try {
      setSavingBatch(true)
      for (const row of batchRows) {
        const groupKey = row.groupKey?.trim() || '未分组'
        const isLocal = isLocalVariableGroup(groupKey)
        const recipeRule = resolveRecipeRule(row.nodeId)
        const normalizedLocalDisplayName = normalizeLocalRecipeDisplayName(row.displayName.trim() || getDisplayName(row.nodeId) || 'Local Variable')
        const localRecipeGroup = resolveLocalRecipeGroupFromDisplay(normalizedLocalDisplayName)
        const payload: TagFormState = {
          ...row,
          nodeId: isLocal ? (row.nodeId.startsWith('local://') ? row.nodeId : '') : row.nodeId,
          displayName: isLocal ? normalizedLocalDisplayName : (row.displayName.trim() || getDisplayName(row.nodeId) || 'Local Variable'),
          groupKey: isLocal ? (localRecipeGroup ?? 'Local Variable') : (recipeRule?.groupKey || groupKey),
          samplingIntervalMs: isLocal ? 0 : (recipeRule?.intervalMs || Number(row.samplingIntervalMs) || 200),
          publishingIntervalMs: isLocal ? 0 : (recipeRule?.intervalMs || Number(row.publishingIntervalMs) || 200),
          allowWrite: Boolean(row.allowWrite),
          enabled: Boolean(row.enabled),
        }

        if (row.id) await updateTag(row.id, payload); else await createTag(payload)
      }
      await loadWorkspace(); await refreshRuntime(); setBatchDrafts([]); setSelectedBrowseNodes([]); setStatusMessage('批量保存成功，列表已清空')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '批量保存失败')
    } finally { setSavingBatch(false) }
  }

  async function deleteBatchRow(row: TagFormState, index: number) {
    try {
      if (row.id) { await deleteTag(row.id); await loadWorkspace(); await refreshRuntime() }
      setBatchDrafts((current) => current.filter((_, i) => i !== index))
      setStatusMessage('变量已删除')
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '删除失败')
    }
  }

  function editRuntimeTag(tag: TagDefinition) {
    const isLocalTag = isLocalVariableTag(tag)
    const deviceName = isLocalTag ? 'Local' : (runtimeNameById[tag.deviceId] || activeDeviceName)
    setSelectedDeviceId(isLocalTag ? (localDevice?.id ?? LOCAL_DEVICE_ID) : tag.deviceId)
    setBatchDrafts([draftFromTag(tag, deviceName)])
    focusBatchSection()
  }
  async function removeRuntimeTag(id: string) { try { await deleteTag(id); await loadWorkspace(); await refreshRuntime(); setStatusMessage('订阅变量已删除') } catch (error) { setStatusMessage(error instanceof Error ? error.message : '删除失败') } }



  function handleSidebarClick(key: SidebarKey) {
    if (!isAuthenticated && (key === 'runtime' || key === 'tags' || key === 'reportConfig')) {
      setView('login')
      setStatusMessage('请先登录后再访问标签、订阅或报表配置页面')
      return
    }


    setView(key)
  }

  const isReportView = view === 'factoryReportDj' || view === 'factoryReportMotor' || view === 'factoryReportQyj' || view === 'factoryReportEngine' || view === 'enduranceReportDj' || view === 'enduranceReportMotor' || view === 'enduranceReportQyj' || view === 'enduranceReportEngine'

  useEffect(() => {
    if (!isReportView) return
    setReportFrameNonce((n) => n + 1)
  }, [view, isReportView])

  useEffect(() => {
    if (!isReportView) return
    setReportFrameLoaded(false)
    setReportFrameTimeout(false)
    const timer = window.setTimeout(() => {
      setReportFrameTimeout(true)
    }, 8000)
    return () => window.clearTimeout(timer)
  }, [isReportView, view, reportFrameNonce])

  function handleLoginSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loginUsername === 'ZXC' && loginPassword === '1826') {
      setIsAuthenticated(true)
      setLoginPassword('')
      setView('runtime')
      setStatusMessage('登录成功，已开放标签、订阅与报表配置菜单')
      return
    }

    setStatusMessage('登录失败：用户名或密码错误')
  }

  function handleLogout() {
    setIsAuthenticated(false)
    setLoginUsername('')
    setLoginPassword('')
    setView('login')
    setStatusMessage('已退出登录')
  }

  function handleAuthEntryClick() {
    if (isAuthenticated) {
      handleLogout()
      return
    }

    setView('login')
    setStatusMessage('请先登录')
  }

  function handleSidebarCollapseToggle() {
    setIsSidebarCollapsed((prev) => {
      const next = !prev
      if (prev && !next) setBrandAnimTick((tick) => tick + 1)
      return next
    })
  }

  function renderSidebarButtons(mode: 'default' | 'runtime') {
    const isRuntime = mode === 'runtime'
    const hasRuntimeEntry = sidebarItems.some((item) => item.key === 'runtime')
    const isNavigationLocked = isSidebarCollapsed
    const firstVisibleReportKey = sidebarItems.find((item) => REPORT_SERVICE_KEYS.includes(item.key as ReportKey))?.key
    const firstVisibleReworkKey = sidebarItems.find((item) => REWORK_SERVICE_KEYS.includes(item.key as ReworkServiceKey))?.key

    const rendered = sidebarItems.flatMap((item) => {
      const itemClass = isRuntime ? (view === item.key ? 'runtime-nav active' : 'runtime-nav') : (view === item.key ? 'nav-item active' : 'nav-item')
      const iconClass = isRuntime ? 'runtime-nav-icon' : 'nav-icon'
      const hasEnglishTitle = /[A-Za-z]/.test(item.label)
      const isEnduranceEnglish = item.key === 'enduranceReportMotor' || item.key === 'enduranceReportEngine'
      const labelClass = [
        isRuntime ? 'runtime-nav-label' : 'nav-label',
        hasEnglishTitle ? 'nav-label-compact' : '',
        isEnduranceEnglish ? 'nav-label-tiny' : '',
      ].filter(Boolean).join(' ')
      const itemTitle = isSidebarCollapsed ? item.label : undefined
      const shouldRenderReportServiceTitle = item.key === firstVisibleReportKey
      const shouldRenderReportGroupTail = item.key === 'production'
      const shouldRenderReworkServiceTitle = item.key === firstVisibleReworkKey
      const shouldRenderReworkGroupTail = item.key === 'reworkRecords'

      if (item.key === 'runtime') {
        return [
          <div key={`sidebar-auth-before-${mode}`}>
            <div className="sidebar-auth-inline">
              <button
                type="button"
                className="sidebar-auth-entry"
                onClick={() => { if (!isNavigationLocked) handleAuthEntryClick() }}
                disabled={isNavigationLocked}
                title={isSidebarCollapsed ? (isAuthenticated ? '退出' : '登录') : undefined}
              >
                <span className="sidebar-auth-icon">{isAuthenticated ? '?' : <UserLoginSidebarIcon />}</span>
                <span className="sidebar-auth-label">{isAuthenticated ? '退出' : '登录'}</span>
              </button>
            </div>
            <button
              type="button"
              className={itemClass}
              onClick={() => { if (!isNavigationLocked) handleSidebarClick(item.key) }}
              disabled={isNavigationLocked}
              title={itemTitle}
            >
              <span className={iconClass}>{item.icon}</span>
              <span className={labelClass}>{item.label}</span>
            </button>
          </div>,
        ]
      }

      const prefix: ReactNode[] = []
      if (shouldRenderReportServiceTitle) {
        prefix.push(
          <div key={`report-service-title-${mode}`} className="sidebar-group-title">
            报表服务
          </div>,
        )
      }
      if (shouldRenderReworkServiceTitle) {
        prefix.push(
          <div key={`rework-service-title-${mode}`} className="sidebar-group-title">
            返修服务
          </div>,
        )
      }
      const suffix = [
        ...(shouldRenderReportGroupTail ? [<div key={`report-group-tail-${mode}`} className="sidebar-divider" aria-hidden="true" />] : []),
        ...(shouldRenderReworkGroupTail ? [<div key={`rework-group-tail-${mode}`} className="sidebar-divider" aria-hidden="true" />] : []),
      ]

      return [
        ...prefix,
        <button
          key={item.key}
          type="button"
          className={itemClass}
          onClick={() => { if (!isNavigationLocked) handleSidebarClick(item.key) }}
          disabled={isNavigationLocked}
          title={itemTitle}
        >
          <span className={iconClass}>{item.icon}</span>
          <span className={labelClass}>{item.label}</span>
        </button>,
        ...suffix,
      ]
    })

    if (!hasRuntimeEntry) {
      rendered.push(
        <div key={`sidebar-auth-tail-${mode}`} className="sidebar-auth-inline">
          <button
            type="button"
            className="sidebar-auth-entry"
            onClick={() => { if (!isNavigationLocked) handleAuthEntryClick() }}
            disabled={isNavigationLocked}
            title={isSidebarCollapsed ? '登录' : undefined}
          >
            <span className="sidebar-auth-icon"><UserLoginSidebarIcon /></span>
            <span className="sidebar-auth-label">登录</span>
          </button>
        </div>,
      )
    }

    return rendered
  }

  const runtimePage = (
    <section className={`runtime-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <section className="runtime-content">
        <header className="runtime-topbar">
          <div className="runtime-title-wrap">
            <h1>清洗机测试系统</h1>
          </div>
          <div className="runtime-topbar-actions">
            <button type="button" className="icon-circle">?</button>
            <button type="button" className="icon-circle">?</button>
            <div className="avatar-circle">SC</div>
          </div>
        </header>

        <section className="runtime-device-status-strip" aria-label="设备连接状态总览">
          <article className="runtime-device-status-card">
            <header className="runtime-device-status-head">
              <strong>设备连接状态</strong>
              <span className="status-line">{onlineDeviceCount}/{deviceStatusCards.length || 0} 正常连接 · 自动更新</span>
            </header>
            <section className="devices-layout" aria-label="设备管理">
              <article className="device-form-panel">
                <div className="panel-head">
                  <div>
                    <div className="panel-title">{deviceDraft.id ? '编辑设备' : '新增设备'}</div>
                    <div className="panel-subtitle">新增设备时可选择 `OPC UA` 或 `Siemens S7` 驱动</div>
                  </div>
                  <div className="panel-actions panel-actions-in-head">
                    <button type="button" className="soft-action" onClick={resetDeviceDraft}>
                      清空
                    </button>
                    <button type="button" className="soft-action danger" onClick={() => void handleDeleteDevice()} disabled={!deviceDraft.id || savingDevice}>
                      删除设备
                    </button>
                    <button type="button" className="primary-action" onClick={() => void handleSaveDevice()} disabled={savingDevice}>
                      {savingDevice ? '保存中' : (deviceDraft.id ? '更新设备' : '创建设备')}
                    </button>
                  </div>
                </div>
                <div className="form-grid">
                  <label>
                    <span>设备名称</span>
                    <input value={deviceDraft.name} onChange={(e) => setDeviceDraft((current) => ({ ...current, name: e.target.value }))} placeholder="例如：Line1 PLC" />
                  </label>
                  <label>
                    <span>驱动类型</span>
                    <select
                      value={deviceDraft.driverKind}
                      onChange={(e) => setDeviceDraft((current) => ({
                        ...current,
                        driverKind: e.target.value,
                        securityMode: e.target.value === 'SiemensS7' ? 'None' : current.securityMode,
                        securityPolicy: e.target.value === 'SiemensS7' ? 'None' : current.securityPolicy,
                      }))}
                    >
                      <option value="OpcUa">OPC UA</option>
                      <option value="SiemensS7">Siemens S7</option>
                    </select>
                  </label>
                  <label>
                    <span>{isSiemensDraft ? 'PLC 地址 / Webserver 地址' : 'Endpoint URL'}</span>
                    <input
                      value={deviceDraft.endpointUrl}
                      onChange={(e) => setDeviceDraft((current) => ({ ...current, endpointUrl: e.target.value }))}
                      placeholder={isSiemensDraft ? '例如：192.168.0.10 或 https://192.168.0.10' : '例如：opc.tcp://192.168.0.10:4840'}
                    />
                  </label>
                  <label>
                    <span>认证方式</span>
                    <select value={deviceDraft.authMode} onChange={(e) => setDeviceDraft((current) => ({ ...current, authMode: e.target.value }))}>
                      <option value="Anonymous">Anonymous</option>
                      <option value="UsernamePassword">Username / Password</option>
                    </select>
                  </label>
                  {!isSiemensDraft && (
                    <>
                      <label>
                        <span>Security Mode</span>
                        <select value={deviceDraft.securityMode} onChange={(e) => setDeviceDraft((current) => ({ ...current, securityMode: e.target.value }))}>
                          <option value="None">None</option>
                          <option value="Sign">Sign</option>
                          <option value="SignAndEncrypt">SignAndEncrypt</option>
                        </select>
                      </label>
                      <label>
                        <span>Security Policy</span>
                        <select value={deviceDraft.securityPolicy} onChange={(e) => setDeviceDraft((current) => ({ ...current, securityPolicy: e.target.value }))}>
                          <option value="None">None</option>
                          <option value="Basic128Rsa15">Basic128Rsa15</option>
                          <option value="Basic256">Basic256</option>
                          <option value="Basic256Sha256">Basic256Sha256</option>
                        </select>
                      </label>
                    </>
                  )}
                  {deviceDraft.authMode === 'UsernamePassword' && (
                    <>
                      <label>
                        <span>用户名</span>
                        <input value={deviceDraft.username} onChange={(e) => setDeviceDraft((current) => ({ ...current, username: e.target.value }))} placeholder="用户名" />
                      </label>
                      <label>
                        <span>密码</span>
                        <input type="password" value={deviceDraft.password} onChange={(e) => setDeviceDraft((current) => ({ ...current, password: e.target.value }))} placeholder="密码" />
                      </label>
                    </>
                  )}
                  <label className="inline-check">
                    <input type="checkbox" checked={deviceDraft.autoConnect} onChange={(e) => setDeviceDraft((current) => ({ ...current, autoConnect: e.target.checked }))} />
                    <span>启动时自动连接</span>
                  </label>
                </div>
                <div className="panel-subtitle">
                  {isSiemensDraft
                    ? 'Siemens S7 驱动通过导入 DB 标签配置点位，并按现有采样参数轮询更新。'
                    : 'OPC UA 驱动保持现有 Endpoint / SecurityMode / SecurityPolicy 连接方式。'}
                </div>
              </article>
              <article className="device-list-panel">
                <div className="panel-head">
                  <div>
                    <div className="panel-title">设备列表</div>
                    <div className="panel-subtitle">选择设备后可编辑、连接、断开，再去浏览变量</div>
                  </div>
                  <div className="panel-actions panel-actions-in-head">
                    <button type="button" className="soft-action" onClick={() => void loadWorkspace()} disabled={loading}>
                      {loading ? '刷新中' : '刷新'}
                    </button>
                    <button type="button" className="soft-action" onClick={() => void handleConnectSelectedDevice()} disabled={!selectedDevice}>
                      连接
                    </button>
                    <button type="button" className="soft-action" onClick={() => void handleDisconnectSelectedDevice()} disabled={!selectedDevice}>
                      断开
                    </button>
                  </div>
                </div>
                <div className="table-shell compact-shell">
                  <div className="table-scroll">
                    <table className="list-table">
                      <colgroup>
                        <col />
                        <col style={{ width: '110px' }} />
                        <col style={{ width: '100px' }} />
                        <col style={{ width: '84px' }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>设备</th>
                          <th>驱动</th>
                          <th>状态</th>
                          <th>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {devices.map((device) => (
                          <tr key={device.id} className="list-row">
                            <td>
                              <strong>{device.name}</strong>
                              <div className="node-meta">{device.endpointUrl}</div>
                            </td>
                            <td>{DRIVER_LABELS[device.driverKind] ?? device.driverKind}</td>
                            <td>{device.status}</td>
                            <td>
                              <div className="row-actions">
                                <button
                                  type="button"
                                  className="mini-button"
                                  onClick={() => {
                                    setSelectedDeviceId(device.id)
                                    loadDeviceIntoDraft(device)
                                  }}
                                >
                                  编辑
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </article>
            </section>
            {deviceStatusCards.length === 0 ? (
              <div className="empty-note">暂无设备状态数据</div>
            ) : (
              <div className="runtime-device-status-list">
                {deviceStatusCards.map((device) => (
                  <div key={device.id} className={`runtime-device-status-item ${device.statusClassName}`}>
                    <div className="runtime-device-status-main">
                      <span className="runtime-device-name">{device.name} · {DRIVER_LABELS[selectedDevice?.id === device.id ? selectedDevice.driverKind : (devices.find((item) => item.id === device.id)?.driverKind ?? 'OpcUa')] ?? 'OPC UA'}</span>
                      <span className="node-meta">{device.endpointUrl}</span>
                    </div>
                    <span className={`status-pill ${device.statusClassName}`}>{device.statusLabel}</span>
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>

        <section className="runtime-toolbar-row runtime-toolbar-row--compact">
          <div className="runtime-toolbar-meta">
            <span>{runtimeRows.length} 条变量</span>
            <span>{loading ? '刷新中' : statusMessage}</span>
          </div>
        </section>

        <section className="runtime-table-wrap">
          <div className="runtime-table-shell">
            <table className="runtime-table project-table">
              <colgroup>
                <col style={{ width: '54px' }} />
                <col style={{ width: '320px' }} />
                <col style={{ width: '92px' }} />
                <col style={{ width: '106px' }} />
                <col style={{ width: '86px' }} />
                <col style={{ width: '164px' }} />
                <col style={{ width: '136px' }} />
                <col />
                <col style={{ width: '132px' }} />
                <col style={{ width: '96px' }} />
                <col style={{ width: '96px' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Risk</th>
                  <th>变量名称</th>
                  <th>当前值</th>
                  <th>数据类型</th>
                  <th>状态</th>
                  <th>最新时间</th>
                  <th className="group-column-head">
                    <div className="table-filter-head">
                      <select className="header-filter" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} aria-label="按分组筛选">
                        <option value="all">全部</option>
                        {groups.filter((g) => g !== 'all').map((g) => <option key={g} value={g}>{g}</option>)}
                      </select>
                    </div>
                  </th>
                  <th>NodeId</th>
                  <th>写入</th>
                  <th>订阅周期</th>
                  <th>发布周期</th>
                </tr>
              </thead>
              <tbody>
                {runtimeRows.map(({ risk, tag, stat, group, healthyValue, time }) => {
                  const displayValue = stat.className === 'normal' ? healthyValue : '暂无数据'
                  return (
                    <tr key={tag.id}>
                      <td className="row-index">{risk}</td>
                      <td>
                        <div className="project-name">{tag.displayName}</div>
                      </td>
                      <td>
                        <div className="project-value">{displayValue}</div>
                      </td>
                      <td>{tag.dataType || '-'}</td>
                      <td>
                        <span className={`project-status ${stat.className === 'normal' ? 'green' : 'red'}`}>
                          <span className="dot" />
                          {stat.className === 'normal' ? 'OK' : 'NG'}
                        </span>
                      </td>
                      <td className="time-cell">{time}</td>
                      <td>
                        <span className="project-pill">{group}</span>
                      </td>
                      <td className="subtle">{isLocalVariableTag(tag) ? '-' : (tag.nodeId || '-')}</td>
                      <td>
                        {tag.allowWrite ? (
                          <div className="write-cell">
                            <input
                              value={writeDrafts[tag.id] ?? ''}
                              onChange={(e) => setWriteDrafts((current) => ({ ...current, [tag.id]: e.target.value }))}
                              placeholder="写入值"
                            />
                            <button type="button" className="write-mini" onClick={() => void handleWrite(tag.id)} disabled={savingTagId === tag.id}>
                              {savingTagId === tag.id ? '...' : '写入'}
                            </button>
                          </div>
                        ) : (
                          <span className="subtle">只读</span>
                        )}
                      </td>
                      <td>{Math.round(tag.samplingIntervalMs)} ms</td>
                      <td>{Math.round(tag.publishingIntervalMs)} ms</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </section>
  )

  const dashboardPage = (
    <section className="dashboard-shell">
      <header className="dashboard-topbar">
        <div className="dashboard-topbar-title">
          <h1>清洗机测试系统</h1>
        </div>
        <div className="dashboard-topbar-meta">
          <span className="dashboard-topbar-pill normal">模板: HMI_DB.Faceplates[1] / [2]</span>
          <button type="button" className="dashboard-icon-button" aria-label="通知">
            ?
          </button>
          <button type="button" className="dashboard-icon-button" aria-label="帮助">
            ?
          </button>
          <div className="dashboard-avatar">SC</div>
        </div>
      </header>

      <section className="dashboard-canvas">
        {dashboardDataList.some((item) => item.available) ? (
          <div className="dashboard-center">
            <div className="dashboard-template-grid">
            {dashboardDataList.map((dashboardData) => (
            <article key={`faceplate-${dashboardData.faceplateIndex}`} className="dashboard-board">
              <header className={`dashboard-board-head ${dashboardData.boardHeadClass}`}>
                <div className="dashboard-board-head-main">
                  <div className="dashboard-board-tag">{dashboardData.title}</div>
                </div>
                <button
                  type="button"
                  className="dashboard-vnc-button"
                  onClick={() => void openVnc(dashboardData.faceplateIndex)}
                  aria-label={`打开 VNC ${dashboardData.faceplateIndex}`}
                >
                  VNC
                </button>
              </header>

              <section className="dashboard-grid">
                <div className="dashboard-barcode-card">
                  <div className="dashboard-barcode-row">
                    <div className="dashboard-card-label">Barcode</div>
                    <div className="dashboard-barcode-value">{dashboardData.stationText}</div>
                  </div>
                </div>

                <div className="dashboard-inlet-card">
                  <div className="dashboard-card-label">Inlet</div>
                  <div className="dashboard-inlet-values inlet-stat-grid">
                    <div className="inlet-stat inlet-blue">
                      <span>Pressure</span>
                      <strong>{dashboardData.inletPressure.text}</strong>
                    </div>
                    <div className="inlet-stat inlet-yellow">
                      <span>Temperature</span>
                      <strong>{dashboardData.inletTemp.text}</strong>
                    </div>
                  </div>
                </div>

                <div className="dashboard-power-card">
                  <div className="dashboard-card-label">Power</div>
                  <div className="dashboard-power-grid">
                    <div className="power-stat power-blue">
                      <span>Voltage</span>
                      <strong>{dashboardData.voltage.text}</strong>
                    </div>
                    <div className="power-stat power-red">
                      <span>Current</span>
                      <strong>{dashboardData.current.text}</strong>
                    </div>
                    <div className="power-stat power-yellow">
                      <span>Frequency</span>
                      <strong>{dashboardData.frequency.text}</strong>
                    </div>
                    <div className="power-stat power-green">
                      <span>Power</span>
                      <strong>{dashboardData.power.text}</strong>
                    </div>
                  </div>
                </div>

                <div className="dashboard-mini-card pressure-card">
                  <div className="dashboard-mini-head">
                    <span>Pressure</span>
                    <strong>{dashboardData.pressure.text}</strong>
                  </div>
                  <MiniSparkline points={dashboardData.pressureSeries} color="#e05b61" />
                </div>

                <div className="dashboard-mini-card flow-card">
                  <div className="dashboard-mini-head">
                    <span>Flow</span>
                    <strong>{dashboardData.flow.text}</strong>
                  </div>
                  <MiniSparkline points={dashboardData.flowSeries} color="#0d6efd" />
                </div>
              </section>

                <section className="dashboard-lower-stack">
                  {dashboardData.showEnduranceCard ? (
                    <article className="dashboard-test-card">
                    <div className="dashboard-test-head">
                      <div className="dashboard-title-row">
                        <div className="dashboard-card-title">耐久测试</div>
                        <div className="dashboard-card-value">{dashboardData.enduranceDuration}</div>
                      </div>
                    </div>
                    <div className="dashboard-endurance-body">
                      <DashboardProgressRing percent={dashboardData.endurancePercent} color="#26a269" />
                      <div className="dashboard-bars">
                        <div className="dashboard-bar-row">
                          <div className="dashboard-bar-label">开枪</div>
                          <div className="dashboard-bar-track">
                            <div className="dashboard-bar-fill positive" style={{ width: `${dashboardData.triggerOnPercent}%` }} />
                          </div>
                        </div>
                        <div className="dashboard-bar-row">
                          <div className="dashboard-bar-label">关枪</div>
                          <div className="dashboard-bar-track">
                            <div className="dashboard-bar-fill negative" style={{ width: `${dashboardData.triggerOffPercent}%` }} />
                          </div>
                        </div>
                        <div className="dashboard-bar-row count-only">
                          <div className="dashboard-bar-label">次数</div>
                          <strong>{formatCount(dashboardData.triggerCount.numeric)}</strong>
                        </div>
                      </div>
                    </div>
                  </article>
                ) : (
                  <article className="dashboard-test-card">
                    <div className="dashboard-test-head">
                      <div className="dashboard-title-row">
                        <div className="dashboard-card-title">出厂测试</div>
                        <div className={`dashboard-card-value workflow-pill ${dashboardData.workflowClass}`}>{dashboardData.workflowText}</div>
                      </div>
                    </div>
                    <div className="dashboard-endurance-body">
                        <DashboardDualProgressRing percent={dashboardData.passPercent} positive="#6159f4" negative="#f08a7b" />
                      <div className="dashboard-bars">
                        <div className="dashboard-bar-row">
                          <div className="dashboard-bar-label">合格</div>
                          <div className="dashboard-bar-track">
                            <div className="dashboard-bar-fill positive" style={{ width: `${dashboardData.passPercent}%` }} />
                          </div>
                          <strong>{dashboardData.passCountText}</strong>
                        </div>
                        <div className="dashboard-bar-row">
                          <div className="dashboard-bar-label">失败</div>
                          <div className="dashboard-bar-track">
                            <div className="dashboard-bar-fill negative" style={{ width: `${dashboardData.failPercent}%` }} />
                          </div>
                          <strong>{dashboardData.failCountText}</strong>
                        </div>
                      </div>
                    </div>
                    </article>
                  )}
                </section>

                <div className={`dashboard-alert ${dashboardData.risk.className}`}>
                  <span>{dashboardData.statusText}</span>
                </div>
              </article>
            ))}
            </div>
          </div>
        ) : (
          <div className="dashboard-empty-state">暂无 HMI_DB.Faceplates[1] / [2] 数据，请先确认点位订阅已恢复。</div>
        )}
      </section>
    </section>
  )

  const renderFactoryReportPage = (key: ReportKey) => {
    const report = REPORTS[key]
    const sep = report.iframeUrl.includes('?') ? '&' : '?'
    const frameUrl = `${report.iframeUrl}${sep}_reportKey=${key}&_ts=${reportFrameNonce}`
    return (
      <section className="page-shell">
        <header className="page-header">
          <div className="page-copy">
            <h1>{report.title}</h1>
            <p>{report.subtitle}</p>
          </div>
          <div className="page-meta">
            <a className="primary-action" href={report.openUrl} target="_blank" rel="noreferrer">
              新窗口打开
            </a>
          </div>
        </header>

        <section className="content-strip" style={{ padding: 0, flex: 1, minHeight: 0 }}>
          {reportFrameTimeout && !reportFrameLoaded ? (
            <div style={{ padding: 16, borderBottom: '1px solid rgba(0,0,0,0.08)', background: '#fff7e6', color: '#8a5a00', fontSize: 14 }}>
              报表加载超时，请重试。
              <button
                type="button"
                className="soft-action"
                style={{ marginLeft: 12 }}
                onClick={() => setReportFrameNonce((n) => n + 1)}
              >
                重试
              </button>
            </div>
          ) : null}
          <iframe
            key={`${key}-${reportFrameNonce}`}
            title={report.title}
            src={frameUrl}
            onLoad={() => {
              setReportFrameLoaded(true)
              setReportFrameTimeout(false)
            }}
            style={{ width: '100%', height: '100%', minHeight: 'calc(100vh - 180px)', border: 0, display: 'block' }}
          />
        </section>

        <div className="toast-line">{statusMessage}</div>
      </section>
    )
  }

  const efficiencyPage = (
    <>
      <EfficiencyAnalysis
        data={efficiencyTimeline}
        loading={efficiencyLoading}
        liveStateByFaceplate={liveEfficiencyStateByFaceplate}
      />
      <div className="toast-line">{statusMessage}</div>
    </>
  )

  const productionPage = (
    <>
      <ProductionStatistics
        data={productionByGw}
        loading={productionLoading}
      />
      <div className="toast-line">{statusMessage}</div>
    </>
  )

  const reworkPage = (
    <>
      <ReworkManagement onSearch={handleLookupRework} onLoadHistory={handleLoadReworkHistory} />
      <div className="toast-line">{statusMessage}</div>
    </>
  )

  const reworkConfigPage = (
    <>
      <ReworkConfig onStatus={showStatus} />
      <div className="toast-line">{statusMessage}</div>
    </>
  )

  const reworkRecordsPage = (
    <>
      <ReworkRecords onSearch={handleQueryRepairRecords} onLoadDaily={handleQueryRepairDaily} />
      <div className="toast-line">{statusMessage}</div>
    </>
  )

  const faultPage = (
    <>
      <FaultAnalysis
        data={faultByGw}
        loading={faultLoading}
      />
      <div className="toast-line">{statusMessage}</div>
    </>
  )

  function matchesBrowseNode(node: BrowseNode) {

    const keyword = browserSearch.trim().toLowerCase()
    if (!keyword) return true
    return [node.displayName, node.browseName, node.nodeId, node.dataType ?? ''].some((item) => item.toLowerCase().includes(keyword))
  }

  function renderBrowseTree(parentNodeId: string | null, level = 0): ReactNode[] {
    const key = `${activeDeviceId}|${parentNodeId ?? '__root__'}`
    const nodes = browseCache[key] ?? []
    return nodes.flatMap((node) => {
      const matches = matchesBrowseNode(node)
      const expanded = Boolean(expandedBrowseNodes[node.nodeId])
      const children = node.hasChildren && expanded ? renderBrowseTree(node.nodeId, level + 1) : []

      if (!matches && children.length === 0) {
        return []
      }

      const isLeaf = !node.hasChildren
      const checked = selectedBrowseNodes.some((item) => item.nodeId === node.nodeId)

      return [
        <div key={node.nodeId} className={`tree-row ${isLeaf ? 'leaf' : 'branch'}`} style={{ paddingLeft: `${level * 22 + 8}px` }}>
          <div className="tree-toggle" aria-hidden="true">
            {isLeaf ? (
              <input type="checkbox" checked={checked} onChange={() => toggleBrowse(node)} aria-label={node.displayName} />
            ) : (
              <button type="button" className="tree-toggle-icon" onClick={() => toggleBrowse(node)} aria-label={`${expanded ? '收起' : '展开'} ${node.displayName}`}>
                {expanded ? '?' : '+'}
              </button>
            )}
          </div>
          <div className="tree-content">
            <button type="button" className="tree-name" onClick={() => toggleBrowse(node)}>
              {node.displayName}
            </button>
            <div className="tree-meta">
              <span>{node.browseName}</span>
              <span>{node.nodeClass}</span>
              <span>{node.dataType ?? '—'}</span>
            </div>
          </div>
          <div className="tree-nodeid">{node.nodeId}</div>
        </div>,
        ...children,
      ]
    })
  }

  const tagsPage = (
    <section className="page-shell">
      <header className="page-header">
        <div className="page-copy">
          <h1>变量订阅</h1>
          <p>{isSiemensDevice ? 'Siemens S7 使用绝对地址模式。请手动新增地址并填写 NodeId（如 DB1.DBX0.0、DB1.DBW2）。' : '逐级浏览 OPC UA 变量目录，勾选叶子变量后进入批量配置。'}</p>
        </div>
        <div className="page-meta">
          <span className="status-line">{activeDeviceName} · {selectedBrowseNodes.length} 个已勾选</span>
          <button type="button" className="soft-action" onClick={() => void loadWorkspace()} disabled={loading}>
            {loading ? '刷新中' : '刷新'}
          </button>
        </div>
      </header>

      <section className="toolbar-row tags-toolbar">
        <input
          ref={importTagsFileInputRef}
          type="file"
          accept=".xlsx"
          onChange={(event) => void handleImportTagsExcel(event)}
          style={{ display: 'none' }}
        />
        <select value={activeDeviceId} onChange={(e) => setSelectedDeviceId(e.target.value)}>
          <option value="">选择设备</option>
          {selectableDevices.map((device) => (
            <option key={device.id} value={device.id}>
              {device.name}
            </option>
          ))}
        </select>
        <input value={browserSearch} onChange={(e) => setBrowserSearch(e.target.value)} placeholder="搜索目录 / 变量 / NodeId" />
        {isSiemensDevice ? null : (
          <button type="button" className="soft-action" onClick={() => setExpandedBrowseNodes({})}>
            折叠全部
          </button>
        )}
        {isSiemensDevice ? null : (
          <button type="button" className="soft-action" onClick={() => void loadBrowse(activeDeviceId, null, true)}>
            刷新目录
          </button>
        )}
        {isSiemensDevice ? (
          <button type="button" className="soft-action" onClick={addManualBatchAddress} disabled={!activeDeviceId}>
            手动新增地址
          </button>
        ) : null}
        <button type="button" className="soft-action" onClick={() => void handleExportAllTagsExcel()} disabled={loading}>
          导出 Excel
        </button>
        <button type="button" className="soft-action" onClick={handlePickImportTagsExcel} disabled={loading}>
          导入替换
        </button>
        <button type="button" className="soft-action" onClick={() => setSelectedBrowseNodes([])}>
          清空勾选
        </button>
      </section>

      <section className="content-strip tags-layout">
        <div className="browser-panel">
          <div className="panel-head">
            <div>
              <div className="panel-title">{isSiemensDevice ? 'DB 标签列表' : '目录树'}</div>
              <div className="panel-subtitle">
                {isSiemensDevice
                  ? '绝对地址模式下不依赖在线目录树，可参考下方样例地址直接手工填写。'
                  : '目录节点展开显示，叶子节点才允许勾选'}
              </div>
            </div>
            <div className="panel-actions panel-actions-in-head">
              <span className="status-line">
                {isSiemensDevice
                  ? '支持示例：DB1.DBX0.0 / DB1.DBW2 / DB1.DBD4 / M0.0'
                  : (rootBrowseLoading ? '目录加载中…' : '当前只看这个目录下的内容')}
              </span>
              <button type="button" className="primary-action" onClick={addSelectionToBatch}>
                加入批量配置
              </button>
            </div>
          </div>
          <div className="tree-shell">
            {!activeDeviceId ? (
              <div className="empty-note">请先选择设备</div>
            ) : isSiemensDevice ? (
              <div className="empty-note">S7 绝对地址模式：点击“手动新增地址”，在批量配置中直接填写 NodeId。</div>
            ) : rootBrowseLoading && rootBrowseNodes.length === 0 ? (
              <div className="empty-note">目录加载中…</div>
            ) : hasLoadedRootBrowse && rootBrowseNodes.length === 0 ? (
              <div className="empty-note">暂无目录数据</div>
            ) : (
              renderBrowseTree(null)
            )}
          </div>
        </div>

        <div className="detail-column">
          <section className="detail-panel detail-panel-batch" ref={batchSectionRef}>
            <div className="panel-head panel-head-stack">
              <div>
                <div className="panel-title">批量配置</div>
                <div className="panel-subtitle">统一修改显示名称、分组和订阅参数，保存后立即刷新订阅</div>
              </div>
              <div className="batch-inline-actions">
                <span className="status-line">{activeDeviceName} · {batchRows.length} 条待配置</span>
                <button type="button" className="soft-action" onClick={loadDeviceTagsToBatch}>
                  载入当前设备变量
                </button>
                <button type="button" className="soft-action" onClick={applyBatchDefaults} disabled={batchRows.length === 0}>
                  应用默认规则
                </button>
                <button type="button" className="soft-action" onClick={clearBatchDrafts} disabled={batchRows.length === 0}>
                  清空列表
                </button>
                <button type="button" className="primary-action" onClick={() => void saveBatch()} disabled={savingBatch || batchRows.length === 0}>
                  {savingBatch ? '保存中' : '保存全部'}
                </button>
              </div>
            </div>
            <div className="table-shell batch-shell batch-inline-shell">
              <div className="table-scroll">
                {batchRows.length === 0 ? (
                  <div className="empty-note batch-empty-note">{isSiemensDevice ? '可点击“手动新增地址”直接录入 NodeId，或载入当前设备已配置变量。' : '先从目录树勾选变量，或载入当前设备已订阅变量。'}</div>
                ) : (
                  <table className="runtime-table batch-table">
                    <colgroup>
                      <col style={{ width: '320px' }} />
                      <col style={{ width: '150px' }} />
                      <col style={{ width: '76px' }} />
                      <col style={{ width: '76px' }} />
                      <col style={{ width: '64px' }} />
                      <col style={{ width: '64px' }} />
                      <col />
                      <col style={{ width: '70px' }} />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>显示名称</th>
                        <th>分组</th>
                        <th>采样</th>
                        <th>发布</th>
                        <th>写入</th>
                        <th>启用</th>
                        <th>NodeId</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {batchRows.map((row, index) => (
                        <tr key={row.id ?? `${row.nodeId}-${index}`}>
                          <td><input value={row.displayName} onChange={(e) => updateBatchRow(index, { displayName: e.target.value })} placeholder="显示名称" /></td>
                          <td><input value={row.groupKey} onChange={(e) => updateBatchRow(index, { groupKey: e.target.value })} placeholder="分组" /></td>
                          <td><input type="number" value={row.samplingIntervalMs} onChange={(e) => updateBatchRow(index, { samplingIntervalMs: Number(e.target.value) || 200 })} /></td>
                          <td><input type="number" value={row.publishingIntervalMs} onChange={(e) => updateBatchRow(index, { publishingIntervalMs: Number(e.target.value) || 200 })} /></td>
                          <td><input type="checkbox" checked={row.allowWrite} onChange={(e) => updateBatchRow(index, { allowWrite: e.target.checked })} /></td>
                          <td><input type="checkbox" checked={row.enabled} onChange={(e) => updateBatchRow(index, { enabled: e.target.checked })} /></td>
                          <td className="subtle">{isLocalVariableGroup(row.groupKey) ? '-' : (row.nodeId || '-')}</td>
                          <td><button type="button" className="mini-button danger" onClick={() => void deleteBatchRow(row, index)}>删除</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </section>

          <section className="detail-panel">
            <div className="panel-head">
              <div>
                <div className="panel-title">已订阅变量</div>
                <div className="panel-subtitle">当前设备下的已配置点位</div>
              </div>
              <div className="panel-actions panel-actions-in-head">
                <span className="status-line">{filteredSelectedDeviceTags.length}/{selectedDeviceTags.length} 个</span>
                <select className="panel-filter-select" value={selectedTagGroupFilter} onChange={(e) => setSelectedTagGroupFilter(e.target.value)} aria-label="按分组筛选已订阅变量">
                  <option value="all">全部分组</option>
                  {selectedDeviceTagGroups.filter((g) => g !== 'all').map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            </div>
            <div className="table-shell compact-shell">
              <div className="table-scroll">
                <table className="list-table">
                  <colgroup>
                    <col />
                    <col style={{ width: '100px' }} />
                    <col style={{ width: '100px' }} />
                    <col style={{ width: '132px' }} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>名称</th>
                      <th>分组</th>
                      <th>写入</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSelectedDeviceTags.map((tag) => (
                      <tr key={tag.id} className="list-row">
                        <td>
                          <strong>{tag.displayName}</strong>
                          <div className="node-meta">{isLocalVariableTag(tag) ? '-' : (tag.nodeId || '-')}</div>
                        </td>
                        <td>{getResolvedGroup(activeDeviceName, tag)}</td>
                        <td>{tag.allowWrite ? '可写' : '只读'}</td>
                        <td>
                          <div className="row-actions">
                            <button type="button" className="mini-button" onClick={() => editRuntimeTag(tag)}>
                              编辑
                            </button>
                            <button type="button" className="mini-button danger" onClick={() => void removeRuntimeTag(tag.id)}>
                              删除
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </div>
      </section>

      <div className="toast-line">{statusMessage}</div>
    </section>
  )

  const recipePage = (
    <section className="page-shell recipe-page-shell">
      <header className="page-header recipe-header">
        <div className="page-copy">
          <h1>{activeRecipeType === 'QYJRecipe' ? '配方-汽油机' : '配方-电机泵'}</h1>
          <p>{activeRecipeType === 'QYJRecipe' ? '汽油机配方参数配置与管理' : '电机泵配方参数配置与管理'}</p>
        </div>
      </header>

      <section className="content-strip recipe-content">
        {activeRecipeType === 'DJRecipe' ? (
          <RecipeDJ
            sourceTags={recipeRows.map(r => r.tag)}
            allTags={runtime.tags}
            snapshots={snapshotByTagId}

            onWrite={(tagId, value) => handleWrite(tagId, value, { successMessage: null, refreshRuntime: false })}

            savingTagId={savingTagId}
            savedRecipes={djRecipeFiles}
            onSaveRecipe={handleSaveDJRecipe}
            onLoadRecipe={handleLoadDJRecipe}
            onDeleteRecipe={handleDeleteDJRecipe}
            loadedRecipeName={djLoadedRecipeName}
            recipeSyncTargets={dashboardSyncTargets}
          />

        ) : (
          <RecipeQYJ
            sourceTags={recipeRows.map(r => r.tag)}
            allTags={runtime.tags}
            snapshots={snapshotByTagId}

            onWrite={(tagId, value) => handleWrite(tagId, value, { successMessage: null, refreshRuntime: false })}
            savingTagId={savingTagId}
            savedRecipes={qyjRecipeFiles}

            onSaveRecipe={handleSaveQYJRecipe}
            onLoadRecipe={handleLoadQYJRecipe}
            onDeleteRecipe={handleDeleteQYJRecipe}
            loadedRecipeName={qyjLoadedRecipeName}
            recipeSyncTargets={dashboardSyncTargets}
          />

        )}
      </section>

      <div className="toast-line">{statusMessage}</div>
    </section>
  )

  function setReportServiceVisible(key: MenuVisibilityKey, visible: boolean) {
    setReportVisibility((current) => ({ ...current, [key]: visible }))
  }

  function resetReportServiceVisibility() {
    setReportVisibility(() => MENU_VISIBILITY_KEYS.reduce((acc, key) => {
      acc[key] = true
      return acc
    }, {} as Record<MenuVisibilityKey, boolean>))
  }

  const reportConfigPage = (
    <section className="page-shell">
      <header className="page-header">
        <div className="page-copy">
          <h1>报表配置</h1>
          <p>配置报表服务下各报表是否在侧边栏显示，设置会自动保存</p>
        </div>
        <div className="panel-actions panel-actions-in-head">
          <span className="status-line">已显示 {reportConfigItems.filter((item) => item.visible).length} / {reportConfigItems.length}</span>
          <button type="button" className="primary-action" onClick={resetReportServiceVisibility}>全部恢复显示</button>
        </div>
      </header>

      <section className="content-strip">
        <div className="config-card">
          <div className="config-card-head">
            <div className="config-card-copy">
              <div className="config-card-title">报表服务</div>
              <div className="config-card-subtitle">仅登录后可见；开关关闭后，侧边栏将隐藏对应报表入口</div>
            </div>
            <label className="station-count-control">
              <span>工位数量</span>
              <input
                type="number"
                min={1}
                max={MAX_STATION_COUNT}
                value={stationCount}
                onChange={(event) => setStationCount(normalizeStationCount(Number(event.target.value)))}
              />
            </label>
          </div>

          <div className="report-config-list">
            {reportConfigItems.map((item) => (
              <label key={item.key} className="report-config-item">
                <span className="report-config-info">
                  <strong>{item.title}</strong>
                  <span>{item.subtitle}</span>
                </span>
                <span className="report-config-toggle">
                  <input
                    type="checkbox"
                    checked={item.visible}
                    onChange={(event) => setReportServiceVisible(item.key, event.target.checked)}
                  />
                  <span>{item.visible ? '显示' : '隐藏'}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      </section>

      <div className="toast-line">{statusMessage}</div>
    </section>
  )

  const [isInIframe, setIsInIframe] = useState(false)

  useEffect(() => {
    // 检测是否在 iframe 中（IDE 预览环境）
    setIsInIframe(window.self !== window.top)
  }, [])

  const helpPage = (
    <section className="page-shell">

      <header className="page-header">
        <div className="page-copy">
          <h1>帮助文档</h1>
          <p>系统内置 PDF 阅读器</p>
        </div>
      </header>

      <section className="content-strip help-layout">
        {isInIframe ? (
          <div className="help-iframe-notice">
            <div className="help-notice-content">
              <h3>?? PDF 文档</h3>
              <p>由于 IDE 内置预览限制，PDF 无法正常显示。</p>
              <p>请在外部浏览器中打开本页面查看帮助文档。</p>
              <a href="/help/manual" target="_blank" rel="noopener noreferrer" className="primary-action">
                在新窗口打开 PDF
              </a>
            </div>
          </div>
        ) : (
          <div className="help-pdf-shell">
            <iframe className="help-pdf-frame" src="/help/manual#zoom=100" title="系统操作手册 PDF" />
          </div>
        )}
      </section>

      <div className="toast-line">{statusMessage}</div>
    </section>
  )

  const loginPage = (
    <section className="page-shell">
      <header className="page-header">
        <div className="page-copy">
          <h1>用户登录</h1>
          <p>登录后才显示“标签”、“订阅”和“报表配置”菜单</p>
        </div>
      </header>

      <section className="content-strip login-layout">
        <div className="login-card">
          <div className="login-head">
            <h2>欢迎登录</h2>
            <p>{LOGIN_SUBTITLE}</p>
          </div>

          {isAuthenticated ? (
            <div className="login-success">
              <strong>当前已登录用户：ZXC</strong>
              <p>你现在可以使用“标签”、“订阅”和“报表配置”三项功能。</p>
              <button type="button" className="login-submit" onClick={handleLogout}>退出登录</button>
            </div>
          ) : (
            <form className="login-form" onSubmit={handleLoginSubmit} autoComplete="off">
              <label>
                <span>用户名</span>
                <input className="login-input" name="login-username" value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} placeholder="请输入用户名" autoComplete="off" />
              </label>
              <label>
                <span>密码</span>
                <input className="login-input" name="login-password" type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="请输入密码" autoComplete="new-password" />
              </label>
              <button type="submit" className="login-submit">登录</button>
            </form>
          )}
        </div>
      </section>

      <div className="toast-line">{statusMessage}</div>
    </section>
  )

  const sidebarShell = (
    <aside className={`sidebar${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>
      <div className="brand">
        <div className="brand-mark">
          <BrandAnimatedTitle key={`brand-title-${brandAnimTick}`} />
        </div>
      </div>
      <div className="sidebar-collapse-row">
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={handleSidebarCollapseToggle}
          aria-label={isSidebarCollapsed ? '展开侧边栏' : '收缩侧边栏'}
          title={isSidebarCollapsed ? '展开' : '收缩'}
        >
          <span className="sidebar-collapse-icon"><SidebarCollapseIcon collapsed={isSidebarCollapsed} /></span>
        </button>
      </div>
      <nav className="sidebar-nav" aria-label="主导航">
        {renderSidebarButtons('default')}
      </nav>

    </aside>
  )

  if (view === 'dashboard') return <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>{sidebarShell}<main className="workspace">{dashboardPage}</main></div>
  if (view === 'factoryReportDj') return <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>{sidebarShell}<main className="workspace">{renderFactoryReportPage('factoryReportDj')}</main></div>
  if (view === 'factoryReportMotor') return <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>{sidebarShell}<main className="workspace">{renderFactoryReportPage('factoryReportMotor')}</main></div>
  if (view === 'factoryReportQyj') return <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>{sidebarShell}<main className="workspace">{renderFactoryReportPage('factoryReportQyj')}</main></div>
  if (view === 'factoryReportEngine') return <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>{sidebarShell}<main className="workspace">{renderFactoryReportPage('factoryReportEngine')}</main></div>
  if (view === 'enduranceReportDj') return <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>{sidebarShell}<main className="workspace">{renderFactoryReportPage('enduranceReportDj')}</main></div>
  if (view === 'enduranceReportMotor') return <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>{sidebarShell}<main className="workspace">{renderFactoryReportPage('enduranceReportMotor')}</main></div>
  if (view === 'enduranceReportQyj') return <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>{sidebarShell}<main className="workspace">{renderFactoryReportPage('enduranceReportQyj')}</main></div>
  if (view === 'enduranceReportEngine') return <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>{sidebarShell}<main className="workspace">{renderFactoryReportPage('enduranceReportEngine')}</main></div>
  if (view === 'efficiency') return <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>{sidebarShell}<main className="workspace">{efficiencyPage}</main></div>
  if (view === 'fault') return <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>{sidebarShell}<main className="workspace">{faultPage}</main></div>
  if (view === 'production') return <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>{sidebarShell}<main className="workspace">{productionPage}</main></div>
  if (view === 'rework') return <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>{sidebarShell}<main className="workspace">{reworkPage}</main></div>
  if (view === 'reworkConfig') return <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>{sidebarShell}<main className="workspace">{reworkConfigPage}</main></div>
  if (view === 'reworkRecords') return <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>{sidebarShell}<main className="workspace">{reworkRecordsPage}</main></div>
  if (view === 'runtime') return <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>{sidebarShell}<main className="workspace">{isAuthenticated ? runtimePage : loginPage}</main></div>

  if (view === 'tags') return <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>{sidebarShell}<main className="workspace">{isAuthenticated ? tagsPage : loginPage}</main></div>
  if (view === 'reportConfig') return <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>{sidebarShell}<main className="workspace">{isAuthenticated ? reportConfigPage : loginPage}</main></div>
  if (view === 'recipeDj' || view === 'recipeQyj') return <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>{sidebarShell}<main className="workspace">{recipePage}</main></div>
  return <div className={`app-shell${isSidebarCollapsed ? ' sidebar-collapsed' : ''}`}>{sidebarShell}<main className="workspace">{view === 'help' ? helpPage : loginPage}</main></div>
}


export default App


