<!-- 此文件由 npm run docs:api 自动生成，请修改 src/features/api-guide/model/apiCatalog*.ts 后重新生成。 -->

# 域名与邮箱地址

**Domains and mailboxes**

读取域名并创建、启停、切换或删除邮箱地址。

> Read domains and create, enable, switch, or delete mailbox addresses.

本分类共 **10** 个端点。返回 [完整 API 索引](README.md) 或 [API 架构与安全说明](../API.md)。

<!-- endpoint:GET /api/domains catalog:e04a28567ea7 -->
## `GET /api/domains`

**读取可用收件域名 / List available receiving domains**

返回当前实例中的域名及其启用状态和邮箱数量。

> Return instance domains with active state and mailbox counts.

| 项目 | 内容 |
| --- | --- |
| 认证 | 登录用户；支持 Session Cookie 或 Access Token |
| 请求 | No parameters |
| 成功响应 | 200 · { domains } |

### cURL 示例

```bash
curl --request GET \
  --url "https://mail.example.com/api/domains" \
  --header "Authorization: Bearer om_at_..."
```

<!-- endpoint:GET /api/mailboxes catalog:9c83eb646b31 -->
## `GET /api/mailboxes`

**列出当前用户邮箱 / List current-user mailboxes**

返回当前用户可见的邮箱地址、主邮箱和启用状态。

> Return visible mailbox addresses, the primary mailbox, and active state.

| 项目 | 内容 |
| --- | --- |
| 认证 | 登录用户；支持 Session Cookie 或 Access Token |
| 请求 | No parameters |
| 成功响应 | 200 · { mailboxes } |

### cURL 示例

```bash
curl --request GET \
  --url "https://mail.example.com/api/mailboxes" \
  --header "Authorization: Bearer om_at_..."
```

<!-- endpoint:POST /api/mailboxes catalog:5c9c6afa1219 -->
## `POST /api/mailboxes`

**创建邮箱地址 / Create a mailbox address**

在启用域名下创建地址；受角色权限、邮箱上限和地址规则限制。

> Create an address on an active domain, subject to role, quota, and address rules.

| 项目 | 内容 |
| --- | --- |
| 认证 | 登录用户；支持 Session Cookie 或 Access Token |
| 请求 | JSON · address |
| 成功响应 | 200/201 · { mailbox } |

### cURL 示例

```bash
curl --request POST \
  --url "https://mail.example.com/api/mailboxes" \
  --header "Authorization: Bearer om_at_..." \
  --header "Content-Type: application/json" \
  --data '{
  "address": "owner@example.com"
}'
```

<!-- endpoint:PATCH /api/mailboxes/:address catalog:91d54c8af03e -->
## `PATCH /api/mailboxes/{address}`

**启停邮箱或设为主邮箱 / Enable, disable, or make a mailbox primary**

更新拥有的邮箱地址；停用或设主地址时会执行安全约束。

> Update an owned mailbox while enforcing disable and primary-address safeguards.

| 项目 | 内容 |
| --- | --- |
| 认证 | 登录用户；支持 Session Cookie 或 Access Token |
| 请求 | Path · address; JSON · isActive? or isPrimary? |
| 成功响应 | 200 · { mailbox } |

### cURL 示例

```bash
curl --request PATCH \
  --url "https://mail.example.com/api/mailboxes/owner%40example.com" \
  --header "Authorization: Bearer om_at_..." \
  --header "Content-Type: application/json" \
  --data '{
  "isPrimary": true
}'
```

<!-- endpoint:DELETE /api/mailboxes/:address catalog:14fb4b9e7ea0 -->
## `DELETE /api/mailboxes/{address}`

**删除非主邮箱 / Delete a non-primary mailbox**

立即隐藏非主邮箱，并启动邮件、草稿和附件的异步清理。

> Hide a non-primary mailbox immediately and start asynchronous mail, draft, and attachment cleanup.

| 项目 | 内容 |
| --- | --- |
| 认证 | 登录用户；支持 Session Cookie 或 Access Token |
| 请求 | Path · address |
| 成功响应 | 202 · { ok: true } |

### cURL 示例

```bash
curl --request DELETE \
  --url "https://mail.example.com/api/mailboxes/owner%40example.com" \
  --header "Authorization: Bearer om_at_..."
```

<!-- endpoint:GET /api/address-tags catalog:f6cbb5b7ceb3 -->
## `GET /api/address-tags`

**列出地址标签 / List address tags**

汇总当前用户的自有域名地址与已接入外部邮箱地址，返回每个地址的来源和标签，以及标签使用次数。

> Aggregate the current user’s own-domain and connected external addresses with their sources, tags, and tag usage counts.

| 项目 | 内容 |
| --- | --- |
| 认证 | 登录用户；支持 Session Cookie 或 Access Token |
| 请求 | No parameters |
| 成功响应 | 200 · { addresses, tags } |

> 注意：标签只对当前用户可见；扩展和 Android 等受限设备令牌无法访问。
>
> Note: Tags are private to the current user; scoped device tokens such as the extension and Android cannot access them.

### cURL 示例

```bash
curl --request GET \
  --url "https://mail.example.com/api/address-tags" \
  --header "Authorization: Bearer om_at_..."
```

<!-- endpoint:PUT /api/address-tags/:address catalog:4a4b9f634ae0 -->
## `PUT /api/address-tags/{address}`

**设置地址的标签 / Set the tags of an address**

整体替换某个地址的标签；每个地址最多 20 个，标签名 1–32 个字符，大小写不敏感去重。

> Replace all tags of an address: up to 20 per address, 1–32 characters each, deduplicated case-insensitively.

| 项目 | 内容 |
| --- | --- |
| 认证 | 登录用户；支持 Session Cookie 或 Access Token |
| 请求 | Path · address; JSON · tags[] |
| 成功响应 | 200 · { address, tags } |

> 注意：标签只对当前用户可见；扩展和 Android 等受限设备令牌无法访问。
>
> Note: Tags are private to the current user; scoped device tokens such as the extension and Android cannot access them.

### cURL 示例

```bash
curl --request PUT \
  --url "https://mail.example.com/api/address-tags/owner%40example.com" \
  --header "Authorization: Bearer om_at_..." \
  --header "Content-Type: application/json" \
  --data '{
  "tags": [
    "example.com"
  ]
}'
```

<!-- endpoint:POST /api/address-tags/batch catalog:9cea3dd4de9e -->
## `POST /api/address-tags/batch`

**批量添加或移除标签 / Add or remove tags in bulk**

为 1–200 个地址批量添加或移除标签，返回这些地址更新后的标签。

> Add or remove tags for 1–200 addresses and return their updated tags.

| 项目 | 内容 |
| --- | --- |
| 认证 | 登录用户；支持 Session Cookie 或 Access Token |
| 请求 | JSON · addresses[], add?[], remove?[] |
| 成功响应 | 200 · { addresses } |

> 注意：标签只对当前用户可见；扩展和 Android 等受限设备令牌无法访问。
>
> Note: Tags are private to the current user; scoped device tokens such as the extension and Android cannot access them.

### cURL 示例

```bash
curl --request POST \
  --url "https://mail.example.com/api/address-tags/batch" \
  --header "Authorization: Bearer om_at_..." \
  --header "Content-Type: application/json" \
  --data '{
  "addresses": [
    "owner@example.com"
  ],
  "add": [
    "example.com"
  ]
}'
```

<!-- endpoint:PATCH /api/address-tags/tags/:tag catalog:5c2f84174b4a -->
## `PATCH /api/address-tags/tags/{tag}`

**重命名或合并标签 / Rename or merge a tag**

把标签重命名到所有地址上；新名称已存在时合并为同一个标签。

> Rename a tag on every address; renaming to an existing tag merges them.

| 项目 | 内容 |
| --- | --- |
| 认证 | 登录用户；支持 Session Cookie 或 Access Token |
| 请求 | Path · tag; JSON · name |
| 成功响应 | 200 · { tag } |

> 注意：标签只对当前用户可见；扩展和 Android 等受限设备令牌无法访问。
>
> Note: Tags are private to the current user; scoped device tokens such as the extension and Android cannot access them.

### cURL 示例

```bash
curl --request PATCH \
  --url "https://mail.example.com/api/address-tags/tags/example.com" \
  --header "Authorization: Bearer om_at_..." \
  --header "Content-Type: application/json" \
  --data '{
  "name": "example.org"
}'
```

<!-- endpoint:DELETE /api/address-tags/tags/:tag catalog:5ac1222b92a0 -->
## `DELETE /api/address-tags/tags/{tag}`

**删除标签 / Delete a tag**

从当前用户的所有地址上移除该标签，不影响地址和邮件。

> Remove the tag from all of the user’s addresses without affecting addresses or mail.

| 项目 | 内容 |
| --- | --- |
| 认证 | 登录用户；支持 Session Cookie 或 Access Token |
| 请求 | Path · tag |
| 成功响应 | 200 · { ok: true } |

> 注意：标签只对当前用户可见；扩展和 Android 等受限设备令牌无法访问。
>
> Note: Tags are private to the current user; scoped device tokens such as the extension and Android cannot access them.

### cURL 示例

```bash
curl --request DELETE \
  --url "https://mail.example.com/api/address-tags/tags/example.com" \
  --header "Authorization: Bearer om_at_..."
```
