import { localized as l, type ApiEndpoint } from './apiCatalogTypes'

const privateNote = l(
  '标签只对当前用户可见；扩展和 Android 等受限设备令牌无法访问。',
  'Tags are private to the current user; scoped device tokens such as the extension and Android cannot access them.',
)

export const addressTagEndpoints: ApiEndpoint[] = [
  {
    method: 'GET', path: '/api/address-tags', group: 'mailboxes', auth: 'authenticated',
    title: l('列出地址标签', 'List address tags'),
    description: l(
      '汇总当前用户的自有域名地址与已接入外部邮箱地址，返回每个地址的来源和标签，以及标签使用次数。',
      'Aggregate the current user’s own-domain and connected external addresses with their sources, tags, and tag usage counts.',
    ),
    request: 'No parameters', response: '200 · { addresses, tags }',
    notes: [privateNote],
  },
  {
    method: 'PUT', path: '/api/address-tags/:address', group: 'mailboxes', auth: 'authenticated',
    title: l('设置地址的标签', 'Set the tags of an address'),
    description: l(
      '整体替换某个地址的标签；每个地址最多 20 个，标签名 1–32 个字符，大小写不敏感去重。',
      'Replace all tags of an address: up to 20 per address, 1–32 characters each, deduplicated case-insensitively.',
    ),
    request: 'Path · address; JSON · tags[]', response: '200 · { address, tags }',
    exampleBody: { tags: ['example.com'] },
    notes: [privateNote],
  },
  {
    method: 'POST', path: '/api/address-tags/batch', group: 'mailboxes', auth: 'authenticated',
    title: l('批量添加或移除标签', 'Add or remove tags in bulk'),
    description: l(
      '为 1–200 个地址批量添加或移除标签，返回这些地址更新后的标签。',
      'Add or remove tags for 1–200 addresses and return their updated tags.',
    ),
    request: 'JSON · addresses[], add?[], remove?[]', response: '200 · { addresses }',
    exampleBody: { addresses: ['owner@example.com'], add: ['example.com'] },
    notes: [privateNote],
  },
  {
    method: 'PATCH', path: '/api/address-tags/tags/:tag', group: 'mailboxes', auth: 'authenticated',
    title: l('重命名或合并标签', 'Rename or merge a tag'),
    description: l(
      '把标签重命名到所有地址上；新名称已存在时合并为同一个标签。',
      'Rename a tag on every address; renaming to an existing tag merges them.',
    ),
    request: 'Path · tag; JSON · name', response: '200 · { tag }',
    examplePath: '/api/address-tags/tags/example.com',
    exampleBody: { name: 'example.org' },
    notes: [privateNote],
  },
  {
    method: 'DELETE', path: '/api/address-tags/tags/:tag', group: 'mailboxes', auth: 'authenticated',
    title: l('删除标签', 'Delete a tag'),
    description: l('从当前用户的所有地址上移除该标签，不影响地址和邮件。', 'Remove the tag from all of the user’s addresses without affecting addresses or mail.'),
    request: 'Path · tag', response: '200 · { ok: true }',
    examplePath: '/api/address-tags/tags/example.com',
    notes: [privateNote],
  },
]
