import type {
  BrowseNode,
  DeviceConnection,
  DeviceFormState,
  RuntimeOverview,
  TagDefinition,
  TagFormState,
} from './types'

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    ...init,
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(message || `Request failed with status ${response.status}`)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

export function getDevices() {
  return request<DeviceConnection[]>('/api/devices')
}

export function createDevice(payload: DeviceFormState) {
  return request<DeviceConnection>('/api/devices', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateDevice(id: string, payload: DeviceFormState) {
  return request<DeviceConnection>(`/api/devices/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function connectDevice(id: string) {
  return request<DeviceConnection>(`/api/devices/${id}/connect`, {
    method: 'POST',
  })
}

export function disconnectDevice(id: string) {
  return request<DeviceConnection>(`/api/devices/${id}/disconnect`, {
    method: 'POST',
  })
}

export function browseDevice(deviceId: string, nodeId?: string) {
  const query = nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ''
  return request<BrowseNode[]>(`/api/devices/${deviceId}/browse${query}`)
}

export function getTags() {
  return request<TagDefinition[]>('/api/tags')
}

export function createTag(payload: TagFormState) {
  return request<TagDefinition>('/api/tags', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function updateTag(id: string, payload: TagFormState) {
  return request<TagDefinition>(`/api/tags/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export function deleteTag(id: string) {
  return request<void>(`/api/tags/${id}`, {
    method: 'DELETE',
  })
}

export function writeTag(tagId: string, value: string) {
  return request(`/api/tags/${tagId}/write`, {
    method: 'POST',
    body: JSON.stringify({ value }),
  })
}

export function getRuntimeOverview() {
  return request<RuntimeOverview>('/api/runtime/overview')
}

export function openVncTool(host: string) {
  return request<{ message: string }>('/api/tools/vnc/open', {
    method: 'POST',
    body: JSON.stringify({ host }),
  })
}
