/**
 * 内容台最终裁决权：与后端 `require_chief_editor` 保持同一套角色口径。
 *
 * 普通 editor / section_editor / board_editor 可以初审、指派互评、催审，
 * 但不能做最终通过/修改/不通过；界面必须隐藏决定入口，避免点击后才 403。
 */
export const CHIEF_EDITOR_ROLES = ['chief_editor', 'deputy_editor', 'editor_in_chief'] as const

export function canFinalDecision(
  isAdmin: boolean | undefined,
  roles: string[] | undefined,
): boolean {
  return Boolean(isAdmin) || (roles ?? []).some((role) =>
    (CHIEF_EDITOR_ROLES as readonly string[]).includes(role),
  )
}
