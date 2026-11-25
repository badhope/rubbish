import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PdfImagePreview from '@/components/pdf-image-preview'

const getMock = vi.fn()

vi.mock('@/lib/api', () => ({
  api: { get: (...args: unknown[]) => getMock(...args) },
}))

vi.mock('@/lib/catalog-download', () => ({
  downloadCatalogArtifact: vi.fn(),
}))

function formatOf(call: unknown[]): unknown {
  return (call[1] as { params?: { format?: string } } | undefined)?.params?.format
}

beforeEach(() => {
  getMock.mockReset()
  getMock.mockImplementation(
    (_url: string, config?: { params?: { format?: string } }) => {
      if (config?.params?.format === 'info') {
        return Promise.resolve({ data: { pages: 3 } })
      }
      return Promise.resolve({
        data: new Blob(['image'], { type: 'image/png' }),
      })
    },
  )
})

describe('PdfImagePreview', () => {
  it('resets to page 1 when the resource changes', async () => {
    const { rerender } = render(
      <PdfImagePreview resourceId={91} version="21" />,
    )
    await waitFor(() =>
      expect(screen.getByText('1 / 3 页')).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByText('下一页'))
    await waitFor(() =>
      expect(screen.getByAltText('PDF 第 2 页')).toBeInTheDocument(),
    )

    rerender(<PdfImagePreview resourceId={3} version="21" />)
    await waitFor(() =>
      expect(screen.getByAltText('PDF 第 1 页')).toBeInTheDocument(),
    )
  })

  it('fetches page count once per resource, not on every page turn', async () => {
    render(<PdfImagePreview resourceId={91} version="21" />)
    await waitFor(() =>
      expect(screen.getByText('1 / 3 页')).toBeInTheDocument(),
    )
    expect(
      getMock.mock.calls.filter((call) => formatOf(call) === 'info'),
    ).toHaveLength(1)

    fireEvent.click(screen.getByText('下一页'))
    fireEvent.click(screen.getByText('下一页'))
    expect(
      getMock.mock.calls.filter((call) => formatOf(call) === 'info'),
    ).toHaveLength(1)
    await waitFor(() =>
      expect(screen.getByAltText('PDF 第 3 页')).toBeInTheDocument(),
    )
  })

  it('offers a retry after an image error', async () => {
    render(<PdfImagePreview resourceId={91} version="21" />)
    await waitFor(() =>
      expect(screen.getByText('1 / 3 页')).toBeInTheDocument(),
    )
    await waitFor(() =>
      expect(screen.getByAltText('PDF 第 1 页')).toBeInTheDocument(),
    )
    fireEvent.error(screen.getByAltText('PDF 第 1 页'))
    expect(screen.getByText('重新加载本页')).toBeInTheDocument()

    fireEvent.click(screen.getByText('重新加载本页'))
    await waitFor(() =>
      expect(getMock).toHaveBeenLastCalledWith('/catalog/91/export', {
        params: { format: 'png', v: '21', page: 1, retry: 1 },
        responseType: 'blob',
        timeout: 120_000,
      }),
    )
    await waitFor(() =>
      expect(screen.getByAltText('PDF 第 1 页')).toBeInTheDocument(),
    )
  })
})

it('jumps to a page, zooms, and supports keyboard paging', async () => {
  render(<PdfImagePreview resourceId={91} version="21" />)
  await waitFor(() => expect(screen.getByText('1 / 3 页')).toBeInTheDocument())

  const jump = screen.getByLabelText('跳转页码')
  fireEvent.change(jump, { target: { value: '3' } })
  fireEvent.submit(jump.closest('form')!)
  expect(screen.getByText('3 / 3 页')).toBeInTheDocument()

  fireEvent.click(screen.getByLabelText('放大'))
  expect(screen.getByText('110%')).toBeInTheDocument()

  fireEvent.keyDown(screen.getByLabelText('PDF 预览'), { key: 'ArrowLeft' })
  expect(screen.getByText('2 / 3 页')).toBeInTheDocument()
})
