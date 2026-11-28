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

// 登录墙关闭后，访客可以匿名浏览的只读页面。账号、投稿、审稿和后台
// 仍然由各自的路由守卫挡住；这里只放行内容面。
const PUBLIC_READ_PATTERNS = [
  ...OVERSEAS_READ_PATTERNS,
  /^\/library$/,
  /^\/library\/[^/]+$/,
  /^\/issues$/,
  /^\/levels$/,
  /^\/explore$/,
  /^\/fields\/[^/]+$/,
]

/** Read-only pages that can be opened without an account once the wall is off. */
export function isPublicReadPath(pathname: string): boolean {
  return PUBLIC_READ_PATTERNS.some((pattern) => pattern.test(pathname))
}
