/** 注销冷静期的恢复凭证。
 *
 * 注销会立刻 bump token_version，这个旧 access token 对普通接口已经失效；
 * 后端只在 30 天软删除窗口内接受它调用 /users/me/restore。把它单独留在
 * localStorage，而不是继续放在 auth store 里，避免后台请求 401 触发
 * refresh → logout，把用户唯一的恢复凭证清掉。
 */
const KEY = 'rubbish-restore-token'
const TTL_MS = 30 * 24 * 60 * 60 * 1000

interface StoredRestoreToken {
  token: string
  expires_at: number
}

export function saveRestoreToken(token: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ token, expires_at: Date.now() + TTL_MS }))
  } catch {
    // 隐私模式可能禁用 localStorage；这时只能靠当前页面会话完成恢复。
  }
}

export function loadRestoreToken(): string | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredRestoreToken
    if (!parsed.token || typeof parsed.expires_at !== 'number' || parsed.expires_at <= Date.now()) {
      localStorage.removeItem(KEY)
      return null
    }
    return parsed.token
  } catch {
    return null
  }
}

export function clearRestoreToken(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // 无存储权限时没有可清理的内容。
  }
}
