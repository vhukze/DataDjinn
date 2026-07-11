import { expect, test } from '@playwright/test'
import {
  clampTreeContextMenuPosition,
  estimateTreeContextMenuHeight,
  TREE_CONTEXT_MENU_FALLBACK_HEIGHT,
  TREE_CONTEXT_MENU_FALLBACK_WIDTH
} from '../../src/renderer/src/app/tree-context-menu-position'

test('tree context menu should keep the clicked node as the anchor when flipping upward @bug', async () => {
  const position = clampTreeContextMenuPosition(273, 468, 180, 92, 1440, 520)

  expect(position.left).toBe(273)
  expect(position.top).toBe(376)
  expect(
    468 - (position.top + 92),
    'flipped menu should stay attached to the click anchor'
  ).toBeLessThanOrEqual(0)
})

test('tree context menu should stay inside the viewport for tall menus @bug', async () => {
  const position = clampTreeContextMenuPosition(
    273,
    468,
    TREE_CONTEXT_MENU_FALLBACK_WIDTH,
    324,
    1440,
    520
  )

  expect(position.left).toBe(273)
  expect(position.top).toBe(144)
  expect(position.top + 324).toBeLessThanOrEqual(520 - 8)
  expect(
    468 - (position.top + 324),
    'tall menu should still stay visually attached to the anchor after flipping'
  ).toBeLessThanOrEqual(0)
})

test('tree context menu height estimation should not permanently pin small menus to the viewport top @bug', async () => {
  const estimatedHeight = estimateTreeContextMenuHeight([
    { key: 'rename', label: '重命名分组' },
    { key: 'delete', label: '删除分组', danger: true }
  ])

  expect(estimatedHeight).toBe(TREE_CONTEXT_MENU_FALLBACK_HEIGHT)

  const fallbackPosition = clampTreeContextMenuPosition(
    120,
    260,
    TREE_CONTEXT_MENU_FALLBACK_WIDTH,
    estimatedHeight,
    400,
    320
  )
  expect(fallbackPosition.top).toBe(20)

  const actualPosition = clampTreeContextMenuPosition(120, 260, 180, 92, 400, 320)
  expect(actualPosition.top).toBe(168)
  expect(actualPosition.top).toBeGreaterThan(fallbackPosition.top)
})
