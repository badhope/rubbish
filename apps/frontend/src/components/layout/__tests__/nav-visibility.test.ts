import { describe, expect, it } from 'vitest'
import { filterNav, type NavViewer } from '../../../lib/nav'
import { MOBILE_MORE } from '../mobile-nav'

const labelsFor = (viewer: NavViewer) =>
  filterNav(MOBILE_MORE, viewer).map((item) => item.label)

describe('chief editor navigation', () => {
  it('主编、副主编与总协调都能看到业务工作台和站务管理', () => {
    for (const role of ['chief_editor', 'deputy_editor', 'editor_in_chief']) {
      const labels = labelsFor({ isAuthenticated: true, isAdmin: false, roles: [role] })
      expect(labels).toContain('互评台')
      expect(labels).toContain('内容台')
      expect(labels).toContain('站务管理')
    }
  })

  it('普通编辑能进内容台，但不冒充主编进站务管理', () => {
    const labels = labelsFor({ isAuthenticated: true, isAdmin: false, roles: ['editor'] })
    expect(labels).toContain('内容台')
    expect(labels).not.toContain('站务管理')
  })

  it('平台管理员不受角色限制', () => {
    const labels = labelsFor({ isAuthenticated: true, isAdmin: true, roles: [] })
    expect(labels).toContain('站务管理')
  })
})
