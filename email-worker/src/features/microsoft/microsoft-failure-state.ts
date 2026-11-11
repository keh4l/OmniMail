import type { MicrosoftAccountStatus } from './microsoft-types'

export const MICROSOFT_SYNC_INTERVAL_SECONDS = 5 * 60
// 凭据或权限问题不会很快自愈，每天自动重试一次即可。
const ATTENTION_RETRY_SECONDS = 24 * 60 * 60
// Microsoft 偶尔会拒绝本来有效的 IMAP OAuth2 登录，稍后手动验证又能通过。
// 最近还同步成功过的账号按临时错误处理并稍后重试，持续失败超过宽限期才标记为权限问题。
const REJECTION_GRACE_SECONDS = 24 * 60 * 60
const REJECTION_RETRY_SECONDS = 15 * 60

const CREDENTIAL_ERRORS = [
  'invalid_grant', 'invalid_client', 'credential_decryption_failed',
  'credential_key_unavailable', 'basic_auth_rejected',
]
const PERMISSION_ERRORS = [
  'imap_scope_missing', 'imap_access_rejected', 'xoauth2_unavailable',
  'invalid_scope', 'unauthorized_client', 'consent_required',
]

export interface MicrosoftFailureState {
  status: Extract<MicrosoftAccountStatus, 'credential_error' | 'permission_error' | 'error'>
  nextSyncAt: number
}

export function microsoftFailureState(
  code: string,
  lastSyncedAt: number | null | undefined,
  now: number,
): MicrosoftFailureState {
  if (CREDENTIAL_ERRORS.includes(code)) {
    return { status: 'credential_error', nextSyncAt: now + ATTENTION_RETRY_SECONDS }
  }
  if (code === 'imap_access_rejected' && lastSyncedAt && now - lastSyncedAt < REJECTION_GRACE_SECONDS) {
    return { status: 'error', nextSyncAt: now + REJECTION_RETRY_SECONDS }
  }
  if (PERMISSION_ERRORS.includes(code)) {
    return { status: 'permission_error', nextSyncAt: now + ATTENTION_RETRY_SECONDS }
  }
  return { status: 'error', nextSyncAt: now + MICROSOFT_SYNC_INTERVAL_SECONDS }
}
