import { describe, expect, it } from 'vitest'

import { parseListField } from '../utils'

describe('parseListField separator contract', () => {
  it('accepts commas, Chinese commas, semicolons and enumeration marks', () => {
    expect(
      parseListField('直肠高敏感，排便反射；肠神经系统、机械感受器'),
    ).toEqual(['直肠高敏感', '排便反射', '肠神经系统', '机械感受器'])
  })

  it('trims, drops blanks and de-duplicates case-insensitively', () => {
    expect(parseListField(' Lean 4, lean 4； 阿奎那 , ,')).toEqual([
      'Lean 4',
      '阿奎那',
    ])
  })
})
