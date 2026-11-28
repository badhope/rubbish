/** 注销凭证独立于登录会话，按服务器给出的删除期限保存在当前浏览器。 */
const KEY = 'rubbish-restore-token'

interface StoredRestoreToken {
  token: string
  expires_at: number
}

export function saveRestoreToken(token: string, deadline: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ token, expires_at: Date.parse(deadline) }))
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
