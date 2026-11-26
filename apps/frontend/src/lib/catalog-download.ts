import type { AxiosRequestConfig } from 'axios'
import axios from 'axios'
import { toast } from 'sonner'
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

/**
 * 带用户可读反馈的下载入口。
 *
 * 后端在区域访问中间件里把匿名大陆/港澳台 API 请求拦成
 * ``{"detail":"region_restricted"}``。原样冒泡会把这段内部串直接弹给读者，
 * 既看不懂也不知道该做什么；这里按状态码翻译成下一步动作。
 */
export async function downloadCatalogArtifactWithFeedback(
  options: CatalogDownloadOptions,
): Promise<void> {
  try {
    await downloadCatalogArtifact(options)
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined
    if (status === 401) {
      toast.error('登录状态已过期，请刷新页面或重新登录后再下载')
      return
    }
    if (status === 403) {
      toast.error('当前登录状态或网络环境不允许下载，请刷新后重试')
      return
    }
    if (status === 404) {
      toast.error('这份文件不存在，或服务端还没生成好')
      return
    }
    if (status === 429) {
      toast.error('下载请求太频繁，请稍后再试')
      return
    }
    toast.error('下载失败，请稍后再试；若一直失败，可在页面底部提交反馈')
  }
}
