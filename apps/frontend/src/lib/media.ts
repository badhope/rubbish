import { api } from '@/lib/api'

/** 上传正文图片；返回可直接插进 Markdown 的站内短链。 */
export async function uploadMediaImage(file: File, purpose: 'submission' | 'forum' | 'note' | 'feedback' | 'shop' = 'submission'): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<{ url: string }>(`/media/images?purpose=${purpose}`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    // 手机弱网传 5MB 图片超过全局 10 秒很常见，不要把它当成“文件太大”。
    timeout: 60_000,
  })
  return data.url
}
