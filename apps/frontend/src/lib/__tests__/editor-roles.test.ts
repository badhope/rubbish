import { describe, expect, it } from 'vitest'
import { canFinalDecision } from '../editor-roles'

describe('内容台最终裁决权', () => {
  it('管理员始终可以最终裁决', () => {
    expect(canFinalDecision(true, [])).toBe(true)
  })

  it('chief / deputy / editor_in_chief 可以最终裁决', () => {
    expect(canFinalDecision(false, ['chief_editor'])).toBe(true)
    expect(canFinalDecision(false, ['deputy_editor'])).toBe(true)
    expect(canFinalDecision(false, ['editor_in_chief'])).toBe(true)
  })

  it('普通 editor / section_editor / board_editor 不能最终裁决', () => {
    expect(canFinalDecision(false, ['editor'])).toBe(false)
    expect(canFinalDecision(false, ['section_editor'])).toBe(false)
    expect(canFinalDecision(false, ['board_editor'])).toBe(false)
    expect(canFinalDecision(false, ['editor', 'board_editor'])).toBe(false)
  })
})
