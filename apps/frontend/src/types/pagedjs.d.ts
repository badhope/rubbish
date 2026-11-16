declare module 'pagedjs' {
  export interface PagedFlow {
    total: number
    destroy?: () => void
    pages?: unknown[]
  }

  export class Previewer {
    preview(
      content: HTMLElement | DocumentFragment | string,
      stylesheets?: Array<string | Record<string, string>>,
      renderTo?: HTMLElement,
      options?: Record<string, unknown>,
    ): Promise<PagedFlow>
  }
}
