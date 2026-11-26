import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { downloadCatalogArtifactWithFeedback } from '@/lib/catalog-download'
import PagedPdfPreview from '@/components/common/paged-pdf-preview'

interface PdfImagePreviewProps {
  resourceId: number
  /** 产物版本号：模板或内容变了必须递增，避免浏览器拿旧图。 */
  version?: string
}

const PREVIEW_CACHE_LIMIT = 20

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/**
 * PDF 版式预览（服务端渲染单页）。
 *
 * 不在浏览器里解析整份 PDF：大文件在移动端要十几秒，慢网会撞超时。
 * 这里只请求当前页 PNG，翻页再取下一页。
 *
 * 页数和页图都必须经 axios 取：直接 <img src="/api/..."> 或裸 fetch
 * 带不上 Authorization，会被 AuthWall 拦成 401（受限地区还会先被
 * RegionAccessMiddleware 拦成 403），整块预览就只剩空白。
 */
export default function PdfImagePreview({
  resourceId,
  version = '27',
}: PdfImagePreviewProps) {
  const viewKey = `${resourceId}:${version}`
  const [totalState, setTotalState] = useState({ key: viewKey, total: 0 })
  const total = totalState.key === viewKey ? totalState.total : 0
  const cacheRef = useRef(new Map<number, string>())

  useEffect(() => {
    cacheRef.current.clear()
    let cancelled = false
    setTotalState({ key: viewKey, total: 0 })
    api
      .get(`/catalog/${resourceId}/export`, {
        params: { format: 'info', v: version },
        timeout: 60_000,
      })
      .then((response) => {
        const payload = response.data as { pages?: number } | undefined
        if (!cancelled && payload?.pages && payload.pages > 0) {
          setTotalState({ key: viewKey, total: payload.pages })
        }
      })
      .catch(() => {
        /* 页数失败不影响单页预览；错误已由 api 拦截器统一提示 */
      })
    return () => {
      cancelled = true
    }
  }, [resourceId, version, viewKey])

  const loadPage = useCallback(
    async (page: number, retry: number) => {
      const cache = cacheRef.current
      if (retry === 0) {
        const cached = cache.get(page)
        if (cached) return cached
      }
      const response = await api.get(`/catalog/${resourceId}/export`, {
        params: {
          format: 'png',
          v: version,
          page,
          ...(retry > 0 ? { retry } : {}),
        },
        responseType: 'blob',
        timeout: 120_000,
      })
      const dataUrl = await blobToDataUrl(response.data as Blob)
      if (cache.size >= PREVIEW_CACHE_LIMIT) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
      cache.set(page, dataUrl)
      return dataUrl
    },
    [resourceId, version],
  )

  return (
    <PagedPdfPreview
      viewKey={viewKey}
      pages={total}
      altPrefix="PDF 第"
      ariaLabel="PDF 预览"
      emptyLabel="正在读取页数…"
      loadPage={loadPage}
      downloadLabel="下载 PDF"
      onDownload={() => {
        void downloadCatalogArtifactWithFeedback({
          resourceId,
          format: 'pdf',
        })
      }}
    />
  )
}
