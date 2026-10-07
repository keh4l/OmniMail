import { apiEndpointCurl, apiEndpoints, apiGroups, displayApiPath } from './apiCatalog'
import type { ApiAuth, ApiEndpoint } from './apiCatalogTypes'

// 供 AI / LLM 阅读的 API 文档，按 https://llmstxt.org 约定生成 /llms.txt 与 /llms-full.txt。
// 内容全部来自 API 目录；修改目录后运行 node scripts/generate-llms-txt.mjs 重新生成。

const EXAMPLE_BASE = 'https://mail.example.com/api'

const authLabels: Record<ApiAuth, string> = {
  public: '公开，无需登录',
  optional: '可选登录，登录后可能返回更多信息',
  authenticated: '登录用户（Session Cookie 或 Bearer Access Token）',
  cookie: '仅浏览器 Session Cookie',
  admin: '管理员或主管理员',
  superAdmin: '仅主管理员',
  webhook: 'Webhook 签名验证',
}

function intro(): string[] {
  return [
    '# OmniMail API',
    '',
    '> OmniMail 是部署在 Cloudflare Workers 上的自托管多域名 Webmail。本文档面向 AI 与自动化工具，说明如何认证并调用当前实例的 HTTP API。',
    '',
    `- 基础地址：本文件所在站点的源地址 + \`/api\`。例如文件位于 \`https://mail.example.com/llms.txt\`，接口就是 \`${EXAMPLE_BASE}/...\`。`,
    `- 接口总数：${apiEndpoints.length}。请求与响应均为 JSON（附件与原文下载除外），错误统一返回 \`{ "error": "说明" }\`。`,
    '- 路径中的 `{address}`、`{id}` 等是路径参数，需要 URL 编码，例如 `owner%40example.com`。',
    '- 当前未带版本前缀的 `/api/*` 主要服务于同仓库客户端，字段可能随版本增加，读取时请忽略未知字段。',
    '',
    '## 认证',
    '',
    '1. `POST /api/auth/token`，JSON `{ "email", "password", "deviceName", "mfaCode"? }`，返回 `accessToken`（15 分钟）和 `refreshToken`（30 天）。令牌明文只返回一次。',
    '2. 之后每个请求带上 `Authorization: Bearer <accessToken>`。',
    '3. Access Token 过期后，用 `POST /api/auth/token/refresh`，JSON `{ "refreshToken" }` 同时轮换两个令牌。',
    '4. 浏览器扩展、Android 等受限设备令牌只能访问其 Scope 允许的接口，越权返回 403。',
    '5. 速率受限时返回 429；D1 日额度耗尽等服务暂停时返回 503，可按响应提示稍后重试。',
    '',
  ]
}

function groupEndpoints(): Array<{ group: typeof apiGroups[number]; endpoints: ApiEndpoint[] }> {
  return apiGroups
    .map((group) => ({ group, endpoints: apiEndpoints.filter((endpoint) => endpoint.group === group.id) }))
    .filter(({ endpoints }) => endpoints.length > 0)
}

function signature(endpoint: ApiEndpoint): string {
  return `${endpoint.method} ${displayApiPath(endpoint.path)}`
}

export function buildLlmsTxt(): string {
  const lines = intro()
  for (const { group, endpoints } of groupEndpoints()) {
    lines.push(`## ${group.title.zh}（${group.title.en}）`, '', group.description.zh, '')
    for (const endpoint of endpoints) {
      lines.push(`- \`${signature(endpoint)}\`：${endpoint.title.zh}。权限：${authLabels[endpoint.auth]}。`)
    }
    lines.push('')
  }
  lines.push(
    '## Optional',
    '',
    '- [完整接口说明](/llms-full.txt)：每个接口的权限、参数、响应、注意事项和 curl 示例合在一个文件里',
    '',
  )
  return lines.join('\n')
}

function endpointDetail(endpoint: ApiEndpoint): string[] {
  const lines = [
    `### ${signature(endpoint)}`,
    '',
    `${endpoint.title.zh} / ${endpoint.title.en}`,
    '',
    endpoint.description.zh,
    '',
    `- 权限：${authLabels[endpoint.auth]}`,
    `- 请求：${endpoint.request}`,
    `- 响应：${endpoint.response}`,
  ]
  for (const note of endpoint.notes ?? []) lines.push(`- 注意：${note.zh}`)
  lines.push('', '```bash', apiEndpointCurl(endpoint, EXAMPLE_BASE), '```', '')
  return lines
}

export function buildLlmsFullTxt(): string {
  const lines = intro()
  lines.push(`> 示例中的 \`${EXAMPLE_BASE}\` 请替换为实际实例地址，\`om_at_...\` 替换为 Access Token。`, '')
  for (const { group, endpoints } of groupEndpoints()) {
    lines.push(`## ${group.title.zh}（${group.title.en}）`, '', group.description.zh, '')
    for (const endpoint of endpoints) lines.push(...endpointDetail(endpoint))
  }
  return lines.join('\n')
}
