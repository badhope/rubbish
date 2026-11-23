export type AccessRegion = 'restricted' | 'overseas' | 'unknown'

const OVERSEAS_READ_PATTERNS = [
  /^\/catalog$/,
  /^\/catalog\/\d+$/,
  /^\/forum$/,
  /^\/forum\/\d+$/,
  /^\/tags$/,
  /^\/search$/,
  /^\/u\/[^/]+$/,
]

/** Read the server-set region cookie. Defaults to restricted when absent. */
export function readAccessRegion(): AccessRegion {
  if (typeof document === 'undefined') return 'unknown'
  const value = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('rubbish_region='))
    ?.split('=')[1]
  if (value === 'overseas') return 'overseas'
  if (value === 'restricted') return 'restricted'
  return 'unknown'
}

/** Published articles/forum reads that overseas guests may open without an account. */
export function isOverseasReadPath(pathname: string): boolean {
  return OVERSEAS_READ_PATTERNS.some((pattern) => pattern.test(pathname))
}
