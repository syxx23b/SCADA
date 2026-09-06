import type { TagSnapshot } from './types'

const QUALITY_OK_VALUES = new Set(['', 'good', '0', '00000000', '0000000'])
const OPC_OK_CONNECTION_STATES = new Set(['', 'connected'])
const LOCAL_OK_CONNECTION_STATES = new Set(['', 'connected', 'localstatic'])

function normalizeStatus(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase()
}

export function isSnapshotQualityOk(snapshot: Pick<TagSnapshot, 'quality'> | undefined) {
  if (!snapshot) return false
  return QUALITY_OK_VALUES.has(normalizeStatus(snapshot.quality))
}

export function isOpcUaTagStatusOk(snapshot: Pick<TagSnapshot, 'quality' | 'connectionState'> | undefined) {
  if (!snapshot) return false
  return isSnapshotQualityOk(snapshot) && OPC_OK_CONNECTION_STATES.has(normalizeStatus(snapshot.connectionState))
}

export function isLocalTagStatusOk(snapshot: Pick<TagSnapshot, 'quality' | 'connectionState'> | undefined) {
  if (!snapshot) return false
  return isSnapshotQualityOk(snapshot) && LOCAL_OK_CONNECTION_STATES.has(normalizeStatus(snapshot.connectionState))
}
