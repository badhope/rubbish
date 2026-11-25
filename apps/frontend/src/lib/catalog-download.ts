import type { AxiosRequestConfig } from 'axios'
import { api } from '@/lib/api'
import { downloadBlob } from '@/lib/utils'

export type CatalogDownloadFormat = 'pdf' | 'docx' | 'original'

interface CatalogDownloadOptions {
  resourceId: number
  format: CatalogDownloadFormat
  /** 兜底文件名；实际优先使用 Content-Disposition 中的标题。 */
  title?: string
}

/**
 * 经 axios 取文章导出件或原件，再落盘。
 *
 * 不能用 <a href="/api/..."> 直链：浏览器导航不会带 Authorization，
 * 大陆/港澳台匿名请求会先被区域访问中间件拦成 403 region_restricted，
 * 登录用户也会被 AuthWall 按无 token 拒绝。api 实例会自动补 Bearer。
 */
export async function downloadCatalogArtifact({
  resourceId,
  format,
  title,
}: CatalogDownloadOptions): Promise<void> {
  const isOriginal = format === 'original'
  const config: AxiosRequestConfig = {
    responseType: 'blob',
    timeout: 180_000,
  }
  if (!isOriginal) {
    config.params = { format, v: 27 }
  }

  const response = await api.get(
    `/catalog/${resourceId}/${isOriginal ? 'file' : 'export'}`,
    config,
  )
  const disposition = String(response.headers['content-disposition'] ?? '')
  const contentType = String(response.headers['content-type'] ?? '')
  const extension = isOriginal
    ? contentType.includes('pdf')
      ? '.pdf'
      : contentType.includes('word')
        ? '.docx'
        : contentType.includes('markdown')
          ? '.md'
          : ''
    : `.${format}`

  const stem = (title ?? `resource-${resourceId}`)
    .replace(/[\\/:*?"<>|\r\n]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  const fallbackName = `${stem || `resource-${resourceId}`}${extension}`

  downloadBlob(response.data as Blob, disposition, fallbackName)
}
