import { expect, test } from '@playwright/test'
import {
  buildDataVersionDiffChangedRows,
  collectDataVersionDiffColumns,
  formatDataVersionIdentity,
  formatDataVersionValue
} from '../../src/renderer/src/app/data-versioning-diff'

test('数据版本差异按行标识和字段展开修改前后值 @bug', async () => {
  const rows = buildDataVersionDiffChangedRows([
    {
      identity: { id: 7 },
      before: { id: 7, title: '旧标题', enabled: false },
      after: { id: 7, title: '新标题', enabled: true },
      changed_columns: ['title', 'enabled']
    }
  ])

  expect(rows).toEqual([
    expect.objectContaining({ identity: { id: 7 }, column: 'title', before: '旧标题', after: '新标题' }),
    expect.objectContaining({ identity: { id: 7 }, column: 'enabled', before: false, after: true })
  ])
  expect(formatDataVersionIdentity(rows[0].identity)).toBe('id = 7')
})

test('数据版本新增和删除行展示非标识字段，并可读化空值与对象 @bug', async () => {
  const changes = [
    {
      identity: { id: 9 },
      before: null,
      after: { id: 9, title: '新增', detail: { source: 'import' } },
      changed_columns: []
    }
  ]

  expect(collectDataVersionDiffColumns(changes, ['id'], 'after')).toEqual(['title', 'detail'])
  expect(formatDataVersionValue(null)).toBe('NULL')
  expect(formatDataVersionValue({ source: 'import' })).toBe('{"source":"import"}')
})
