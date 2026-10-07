import {
  AddressTagError,
  AddressTagStore,
  normalizeAddressList,
  normalizeTag,
  normalizeTagAddress,
  normalizeTagList,
} from './address-tag-store'
import type { Env, SessionUser } from '../../app/types'

// 标签是用户私人备注：不写操作日志，响应也禁止共享缓存，避免泄露注册过哪些网站。
function privateJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

async function jsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json<unknown>()
    if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error()
    return body as Record<string, unknown>
  } catch {
    throw new AddressTagError(400, '请求体必须是 JSON 对象。')
  }
}

// 只转换已知业务错误；额度、网络等异常继续抛给全局 onError 统一处理。
async function respond(operation: () => Promise<Response>): Promise<Response> {
  try {
    return await operation()
  } catch (error) {
    if (error instanceof AddressTagError) return privateJson({ error: error.message, ...error.details }, error.status)
    throw error
  }
}

export function listAddressTags(env: Env, user: SessionUser): Promise<Response> {
  return respond(async () => privateJson(await new AddressTagStore(env, user.id).list()))
}

export function replaceAddressTags(
  env: Env,
  user: SessionUser,
  rawAddress: string,
  request: Request,
): Promise<Response> {
  return respond(async () => {
    const address = normalizeTagAddress(rawAddress)
    const body = await jsonObject(request)
    const tags = await new AddressTagStore(env, user.id).replace(address, normalizeTagList(body.tags))
    return privateJson({ address, tags })
  })
}

export function batchAddressTags(env: Env, user: SessionUser, request: Request): Promise<Response> {
  return respond(async () => {
    const body = await jsonObject(request)
    const addresses = normalizeAddressList(body.addresses)
    const add = body.add === undefined ? [] : normalizeTagList(body.add)
    const remove = body.remove === undefined ? [] : normalizeTagList(body.remove)
    return privateJson({ addresses: await new AddressTagStore(env, user.id).batch(addresses, add, remove) })
  })
}

export function renameAddressTag(
  env: Env,
  user: SessionUser,
  rawTag: string,
  request: Request,
): Promise<Response> {
  return respond(async () => {
    const from = normalizeTag(rawTag)
    const body = await jsonObject(request)
    return privateJson({ tag: await new AddressTagStore(env, user.id).rename(from, normalizeTag(body.name)) })
  })
}

export function deleteAddressTag(env: Env, user: SessionUser, rawTag: string): Promise<Response> {
  return respond(async () => {
    await new AddressTagStore(env, user.id).remove(normalizeTag(rawTag))
    return privateJson({ ok: true })
  })
}
