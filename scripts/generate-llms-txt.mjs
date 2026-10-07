import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createServer } from 'vite'

// 从 API 目录生成 public/llms.txt 与 public/llms-full.txt，部署后由站点根路径直接提供。
const root = process.cwd()
const vite = await createServer({
  root,
  logLevel: 'error',
  // 关闭文件监听：写入 public/ 时不触发热更新，避免关闭服务器时出现过期请求错误。
  server: { middlewareMode: true, hmr: false, watch: null },
  appType: 'custom',
})

try {
  const { buildLlmsTxt, buildLlmsFullTxt } = await vite.ssrLoadModule('/src/features/api-guide/model/llmsTxt.ts')
  await writeFile(path.join(root, 'public', 'llms.txt'), buildLlmsTxt(), 'utf8')
  await writeFile(path.join(root, 'public', 'llms-full.txt'), buildLlmsFullTxt(), 'utf8')
  console.log('Generated public/llms.txt and public/llms-full.txt.')
} finally {
  await vite.close()
}
