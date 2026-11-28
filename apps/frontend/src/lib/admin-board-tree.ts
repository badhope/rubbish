/**
 * Admin-only ordering for forum boards.
 *
 * The API returns a flat list. Sorting every row together makes a child with
 * sort_order 1 appear before its parent's second child if an unrelated parent
 * also has sort_order 1. Keep siblings sorted, but walk each parent's subtree
 * before moving to the next root.
 */
export interface BoardOrderRow {
  id: number
  parent_id: number | null
  sort_order: number
}

export type OrderedBoard<T extends BoardOrderRow> = T & { depth: number }

function compareBoards<T extends BoardOrderRow>(a: T, b: T): number {
  return a.sort_order - b.sort_order || a.id - b.id
}

export function orderForumBoards<T extends BoardOrderRow>(rows: T[]): OrderedBoard<T>[] {
  const ids = new Set(rows.map((row) => row.id))
  const roots: T[] = []
  const children = new Map<number, T[]>()

  for (const row of rows) {
    if (row.parent_id != null && ids.has(row.parent_id)) {
      const siblings = children.get(row.parent_id) ?? []
      siblings.push(row)
      children.set(row.parent_id, siblings)
    } else {
      roots.push(row)
    }
  }

  roots.sort(compareBoards)
  for (const siblings of children.values()) siblings.sort(compareBoards)

  const ordered: OrderedBoard<T>[] = []
  const visited = new Set<number>()

  const visit = (board: T, depth: number) => {
    if (visited.has(board.id)) return
    visited.add(board.id)
    ordered.push({ ...board, depth })
    for (const child of children.get(board.id) ?? []) visit(child, depth + 1)
  }

  for (const root of roots) visit(root, 0)
  // A malformed parent chain (or a cycle) must not hide remaining boards.
  for (const row of [...rows].sort(compareBoards)) {
    if (!visited.has(row.id)) visit(row, 0)
  }

  return ordered
}
