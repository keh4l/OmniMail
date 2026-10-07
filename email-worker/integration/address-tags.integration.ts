import { env } from 'cloudflare:workers'
import { applyD1Migrations, createExecutionContext } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import worker from '../src/index'
import { sha256 } from '../src/features/auth/session/auth'
import { EXTENSION_DEVICE_SCOPES } from '../src/features/auth/tokens/token-scope'

const fullToken = `om_at_${'f'.repeat(43)}`
const extensionToken = `om_at_${'e'.repeat(43)}`

async function deviceSession(id: string, token: string, scopes: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  await env.DB.prepare(
    `INSERT INTO device_sessions (
      id, user_id, device_name, access_token_hash, access_expires_at,
      refresh_token_hash, refresh_expires_at, last_used_at, scopes
    ) VALUES (?, 'tag-user', ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, id, await sha256(token), now + 900, await sha256(`${token}-refresh`), now + 3600, now, scopes).run()
}

function call(path: string, init: RequestInit = {}, token = fullToken): Promise<Response> {
  return worker.fetch(new Request(`https://mail.example.com${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  }), env, createExecutionContext())
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  await env.DB.prepare(
    `INSERT INTO users (id, email, display_name, password_hash, role, can_create_mailboxes)
     VALUES ('tag-user', 'tags@example.com', 'Tags', 'test', 'user', 1)`,
  ).run()
  await env.DB.prepare(
    `INSERT INTO mailboxes (address, user_id, is_primary) VALUES
       ('signup@mail.example.com', 'tag-user', 1), ('second@mail.example.com', 'tag-user', 0)`,
  ).run()
  await deviceSession('full-device', fullToken, '*')
  await deviceSession('OmniMail Float', extensionToken, EXTENSION_DEVICE_SCOPES)
})

describe('address tag routes on D1', () => {
  it('tags, filters, renames and deletes through the Worker API', async () => {
    const put = await call('/api/address-tags/signup%40mail.example.com', {
      method: 'PUT', body: JSON.stringify({ tags: ['网站A', 'GitHub'] }),
    })
    expect(put.status).toBe(200)
    await expect(put.json()).resolves.toEqual({ address: 'signup@mail.example.com', tags: ['网站A', 'GitHub'] })

    const batch = await call('/api/address-tags/batch', {
      method: 'POST',
      body: JSON.stringify({ addresses: ['signup@mail.example.com', 'second@mail.example.com'], add: ['github'], remove: ['网站A'] }),
    })
    await expect(batch.json()).resolves.toEqual({ addresses: [
      { address: 'signup@mail.example.com', tags: ['GitHub'] },
      { address: 'second@mail.example.com', tags: ['GitHub'] },
    ] })

    const stranger = await call('/api/address-tags/batch', {
      method: 'POST', body: JSON.stringify({ addresses: ['second@mail.example.com', 'stranger@else.test'], add: ['网站B'] }),
    })
    expect(stranger.status).toBe(400)
    await expect(stranger.json()).resolves.toEqual({
      error: '只能给你邮箱里的地址添加标签。', unknownAddresses: ['stranger@else.test'],
    })

    const renamed = await call(`/api/address-tags/tags/${encodeURIComponent('GitHub')}`, {
      method: 'PATCH', body: JSON.stringify({ name: '代码托管' }),
    })
    await expect(renamed.json()).resolves.toEqual({ tag: { name: '代码托管', count: 2 } })

    const listed = await call('/api/address-tags')
    expect(listed.headers.get('Cache-Control')).toBe('private, no-store')
    await expect(listed.json()).resolves.toEqual({
      addresses: [
        { address: 'second@mail.example.com', sources: ['omnimail'], isActive: true, tags: ['代码托管'] },
        { address: 'signup@mail.example.com', sources: ['omnimail'], isActive: true, tags: ['代码托管'] },
      ],
      tags: [{ name: '代码托管', count: 2 }],
    })

    const deleted = await call(`/api/address-tags/tags/${encodeURIComponent('代码托管')}`, { method: 'DELETE' })
    expect(deleted.status).toBe(200)
    await expect((await call('/api/address-tags')).json()).resolves.toMatchObject({ tags: [] })
  })

  it('keeps address tags out of scoped extension tokens', async () => {
    const denied = await call('/api/address-tags', {}, extensionToken)
    expect(denied.status).toBe(403)
  })
})
