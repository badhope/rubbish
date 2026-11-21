/** Display-only role names. API/DB role codes stay stable. */
export const ROLE_LABELS: Record<string, string> = {
  chief_editor: '主编',
  editor_in_chief: '主编',
  deputy_editor: '副主编',
  board_editor: '栏目编辑',
  section_editor: '栏目编辑',
  editor: '编辑',
  reviewer: '评审',
  senior_reviewer: '资深评审',
  shop_manager: '站务',
  author: '作者',
  reader: '成员',
  user: '成员',
  admin: '站务',
}

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role
}

/** 侧栏/身份处只显示一个最高角色，避免“评审却写成成员”。 */
export function primaryRoleLabel(roles: string[], isAdmin: boolean): string {
  if (isAdmin) return '编辑部'
  const set = new Set(roles)
  if (set.has('editor_in_chief') || set.has('chief_editor') || set.has('deputy_editor')) return '编辑部'
  if (set.has('board_editor') || set.has('section_editor') || set.has('editor')) return '编辑'
  if (set.has('senior_reviewer')) return '资深评审'
  if (set.has('reviewer')) return '评审'
  if (set.has('author')) return '作者'
  return '成员'
}
