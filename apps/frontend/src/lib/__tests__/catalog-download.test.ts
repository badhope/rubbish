import { beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadCatalogArtifact } from '@/lib/catalog-download'

const getMock = vi.fn()
const downloadBlobMock = vi.fn()

vi.mock('@/lib/api', () => ({
  api: { get: (...args: unknown[]) => getMock(...args) },
}))

vi.mock('@/lib/utils', () => ({
  downloadBlob: (...args: unknown[]) => downloadBlobMock(...args),
}))

beforeEach(() => {
  getMock.mockReset()
  downloadBlobMock.mockReset()
})

describe('downloadCatalogArtifact', () => {
  it('fetches exports through the authenticated api client', async () => {
    const blob = new Blob(['pdf'], { type: 'application/pdf' })
    getMock.mockResolvedValue({
      data: blob,
      headers: {
        'content-disposition': "attachment; filename*=UTF-8''%E6%B5%8B%E8%AF%95.pdf",
        'content-type': 'application/pdf',
      },
    })

    await downloadCatalogArtifact({
      resourceId: 304,
      format: 'pdf',
      title: '光周期 / PADA',
    })

    expect(getMock).toHaveBeenCalledWith('/catalog/304/export', {
      responseType: 'blob',
      timeout: 180_000,
      params: { format: 'pdf', v: 27 },
    })
    expect(downloadBlobMock).toHaveBeenCalledWith(
      blob,
      "attachment; filename*=UTF-8''%E6%B5%8B%E8%AF%95.pdf",
      '光周期 - PADA.pdf',
    )
  })

  it('downloads the original file with an extension from content-type', async () => {
    const blob = new Blob(['docx'], {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    getMock.mockResolvedValue({
      data: blob,
      headers: { 'content-type': blob.type },
    })

    await downloadCatalogArtifact({
      resourceId: 304,
      format: 'original',
      title: '原始记录',
    })

    expect(getMock).toHaveBeenCalledWith('/catalog/304/file', {
      responseType: 'blob',
      timeout: 180_000,
    })
    expect(downloadBlobMock).toHaveBeenCalledWith(
      blob,
      '',
      '原始记录.docx',
    )
  })
})
