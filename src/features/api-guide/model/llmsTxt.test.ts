import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { apiEndpointKey, apiEndpoints } from './apiCatalog'
import { buildLlmsFullTxt, buildLlmsTxt } from './llmsTxt'

const regenerate = '请运行 node scripts/generate-llms-txt.mjs 重新生成'

describe('llms.txt API documentation', () => {
  it('stays in sync with the API catalog', () => {
    expect(readFileSync('public/llms.txt', 'utf8'), regenerate).toBe(buildLlmsTxt())
    expect(readFileSync('public/llms-full.txt', 'utf8'), regenerate).toBe(buildLlmsFullTxt())
  })

  it('follows the llms.txt layout and covers every endpoint', () => {
    const index = buildLlmsTxt()
    const full = buildLlmsFullTxt()
    expect(index.startsWith('# OmniMail API\n\n> ')).toBe(true)
    expect(index).toContain('[完整接口说明](/llms-full.txt)')
    for (const endpoint of apiEndpoints) {
      const heading = `### ${apiEndpointKey(endpoint).replace(/:([A-Za-z]+)/g, '{$1}')}`
      expect(full.split('\n').filter((line) => line === heading), heading).toHaveLength(1)
    }
  })
})
