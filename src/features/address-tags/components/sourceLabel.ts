import { t } from '../../../shared/i18n'
import type { AddressTagSource } from '../api/address-tag-api-client'

export function sourceLabel(source: AddressTagSource): string {
  switch (source) {
    case 'omnimail': return t('自有域名')
    case 'icloud': return 'iCloud'
    case 'icloud-hme': return t('iCloud 隐藏邮箱')
    case 'gmail': return 'Gmail'
    case 'microsoft': return 'Microsoft'
    case 'qq': return t('QQ 邮箱')
    case 'naver': return 'NAVER'
    case 'yandex': return 'Yandex'
    case 'linuxdo': return 'Linux DO'
    default: return t('已不在邮箱里')
  }
}
