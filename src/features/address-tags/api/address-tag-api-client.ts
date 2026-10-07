import { request } from '../../../shared/api/api-client'

export type AddressTagSource =
  | 'omnimail'
  | 'icloud'
  | 'icloud-hme'
  | 'gmail'
  | 'microsoft'
  | 'qq'
  | 'naver'
  | 'yandex'
  | 'linuxdo'
  | 'other'

export interface AddressTagEntry {
  address: string
  sources: AddressTagSource[]
  isActive?: boolean
  tags: string[]
}

export interface AddressTagSummary {
  name: string
  count: number
}

export interface AddressTagUpdate {
  address: string
  tags: string[]
}

function tagPath(tag: string): string {
  return `/api/address-tags/tags/${encodeURIComponent(tag)}`
}

export const addressTagApi = {
  list: (signal?: AbortSignal) => request<{ addresses: AddressTagEntry[]; tags: AddressTagSummary[] }>(
    '/api/address-tags', { signal },
  ),
  replace: (address: string, tags: string[]) => request<AddressTagUpdate>(
    `/api/address-tags/${encodeURIComponent(address)}`,
    { method: 'PUT', body: JSON.stringify({ tags }) },
  ),
  batch: (addresses: string[], change: { add?: string[]; remove?: string[] }) => request<{
    addresses: AddressTagUpdate[]
  }>('/api/address-tags/batch', { method: 'POST', body: JSON.stringify({ addresses, ...change }) }),
  rename: (tag: string, name: string) => request<{ tag: AddressTagSummary }>(
    tagPath(tag), { method: 'PATCH', body: JSON.stringify({ name }) },
  ),
  remove: (tag: string) => request<{ ok: true }>(tagPath(tag), { method: 'DELETE' }),
}
