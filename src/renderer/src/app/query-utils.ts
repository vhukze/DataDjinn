export const DEFAULT_RESULT_COLUMN_WIDTH = 180
export const MIN_RESULT_COLUMN_WIDTH = 88
export const MAX_RESULT_COLUMN_WIDTH = 640

const QUERY_SELECT_MIN_WIDTH = 160
const QUERY_SELECT_MAX_WIDTH = 320
const QUERY_SELECT_HORIZONTAL_PADDING = 52
const QUERY_SELECT_CHAR_WIDTH = 8

export const getResultTableScrollHeight = (element: HTMLDivElement): number => {
  const headerHeight = element.querySelector<HTMLElement>('.ant-table-header')?.offsetHeight ?? 0
  const shell = element.closest<HTMLElement>('.result-table-content')
  const availableHeight = shell?.clientHeight ?? element.clientHeight
  return Math.max(160, availableHeight - headerHeight)
}

export const clampResultColumnWidth = (width: number): number =>
  Math.min(MAX_RESULT_COLUMN_WIDTH, Math.max(MIN_RESULT_COLUMN_WIDTH, Math.round(width)))

export const normalizeCellSelectionKeys = (cellKeys: string[]): string[] =>
  Array.from(new Set(cellKeys)).sort((left, right) => left.localeCompare(right))

export const getQuerySelectWidth = (labels: string[], fallbackLabel?: string): number => {
  const candidates = [...labels, fallbackLabel ?? ''].filter(Boolean)
  const longestLength = candidates.reduce((max, current) => Math.max(max, current.length), 0)
  const estimatedWidth = longestLength * QUERY_SELECT_CHAR_WIDTH + QUERY_SELECT_HORIZONTAL_PADDING
  return Math.min(QUERY_SELECT_MAX_WIDTH, Math.max(QUERY_SELECT_MIN_WIDTH, estimatedWidth))
}
