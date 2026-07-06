import type { MenuProps } from 'antd'

export const TREE_CONTEXT_MENU_VIEWPORT_MARGIN = 8
export const TREE_CONTEXT_MENU_FALLBACK_WIDTH = 220
export const TREE_CONTEXT_MENU_FALLBACK_HEIGHT = 240

export function estimateTreeContextMenuHeight(items: MenuProps['items']): number {
  const normalizedItems = (items ?? []).filter(Boolean)
  const dividerCount = normalizedItems.filter((item) => typeof item === 'object' && item && 'type' in item && item.type === 'divider').length
  const actionCount = Math.max(0, normalizedItems.length - dividerCount)
  return Math.max(
    TREE_CONTEXT_MENU_FALLBACK_HEIGHT,
    12 + actionCount * 36 + dividerCount * 10
  )
}

export function clampTreeContextMenuPosition(
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number = window.innerWidth,
  viewportHeight: number = window.innerHeight
): { left: number, top: number } {
  const maxLeft = Math.max(TREE_CONTEXT_MENU_VIEWPORT_MARGIN, viewportWidth - width - TREE_CONTEXT_MENU_VIEWPORT_MARGIN)
  const maxTop = Math.max(TREE_CONTEXT_MENU_VIEWPORT_MARGIN, viewportHeight - height - TREE_CONTEXT_MENU_VIEWPORT_MARGIN)
  let left = Math.min(x, maxLeft)
  let top = y

  if (top + height > viewportHeight - TREE_CONTEXT_MENU_VIEWPORT_MARGIN) {
    top = Math.max(TREE_CONTEXT_MENU_VIEWPORT_MARGIN, y - height)
  }

  left = Math.max(TREE_CONTEXT_MENU_VIEWPORT_MARGIN, left)
  top = Math.max(TREE_CONTEXT_MENU_VIEWPORT_MARGIN, Math.min(top, maxTop))

  return { left, top }
}
