/** Display-only role names. API/DB role codes stay stable. */
export const ROLE_LABELS: Record<string, string> = {
  chief_editor: '内容主管',
  editor_in_chief: '总协调',
  deputy_editor: '内容副主管',
  board_editor: '内容策展',
  section_editor: '分区整理',
  editor: '内容整理',
  reviewer: '互评成员',
  senior_reviewer: '资深互评成员',
  shop_manager: '经验管理员',
  author: '作者',
  reader: '成员',
  user: '成员',
  admin: '站务',
}

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
}

/** 侧栏/身份处只显示一个最高角色，避免“互评却写成成员”。 */
export function primaryRoleLabel(roles: string[], isAdmin: boolean): string {
  if (isAdmin) return '站务组'
  const set = new Set(roles)
  if (set.has('editor_in_chief') || set.has('chief_editor') || set.has('deputy_editor')) return '站务组'
  if (set.has('board_editor')) return '内容策展'
  if (set.has('section_editor') || set.has('editor')) return '内容整理'
  if (set.has('senior_reviewer')) return '资深互评成员'
  if (set.has('reviewer')) return '互评成员'
  if (set.has('author')) return '作者'
  return '成员'
}
