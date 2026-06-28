import {
  CloseOutlined,
  DownOutlined,
  FilterOutlined,
  UpOutlined
} from '@ant-design/icons'
import {
  Button,
  Checkbox,
  Flex,
  Input,
  Space,
  Table,
  Typography
} from 'antd'
import type { InputRef } from 'antd'
import type { ColumnsType, TableRef } from 'antd/es/table'
import { createPortal } from 'react-dom'
import { memo, startTransition, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'

type EditableRowLike = Record<string, unknown> & {
  __rowKey: string
  __state?: 'inserted' | 'updated'
  __deleted?: boolean
}

type TableSearchUiStateLike = {
  visible: boolean
  query: string
  caseSensitive: boolean
  regex: boolean
  wholeWord: boolean
  filterRows: boolean
  activeMatchIndex: number
}

type WorkspaceTabLike = {
  key: string
  kind: string
  tableRenderVersion?: number
}

export const getResultTableScrollHeight = (element: HTMLDivElement): number => {
  const headerHeight = element.querySelector<HTMLElement>('.ant-table-header')?.offsetHeight ?? 0
  const shell = element.closest<HTMLElement>('.result-table-content')
  const availableHeight = shell?.clientHeight ?? element.clientHeight
  return Math.max(160, availableHeight - headerHeight)
}

type DefaultValueMarker = {
  __datadjinn_action__: 'default'
}

type SearchMatcher = {
  matches: (text: string) => boolean
  highlight: (text: string) => string | null
}

const WHERE_HIGHLIGHT_KEYWORDS = [
  'AND',
  'OR',
  'NOT',
  'IN',
  'EXISTS',
  'BETWEEN',
  'LIKE',
  'IS',
  'NULL',
  'TRUE',
  'FALSE',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END'
]

const escapeHtml = (value: string): string => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const buildWhereHighlightedHtml = (text: string): string | null => {
  if (!text) {
    return null
  }
  const pattern = /'(?:''|[^'])*'|"(?:[^"\\]|\\.)*"|\b\d+(?:\.\d+)?\b|\b(?:AND|OR|NOT|IN|EXISTS|BETWEEN|LIKE|IS|NULL|TRUE|FALSE|CASE|WHEN|THEN|ELSE|END)\b/gi
  const matches = [...text.matchAll(pattern)]
  if (matches.length === 0) {
    return null
  }

  let cursor = 0
  let html = ''
  for (const match of matches) {
    const matchIndex = match.index ?? -1
    const matchedText = match[0] ?? ''
    if (matchIndex < 0 || matchedText.length === 0) {
      continue
    }
    if (matchIndex > cursor) {
      html += escapeHtml(text.slice(cursor, matchIndex))
    }
    const upper = matchedText.toUpperCase()
    let className = 'where-token where-token-identifier'
    if (/^'.*'$|^".*"$/.test(matchedText)) {
      className = 'where-token where-token-string'
    } else if (/^\d+(?:\.\d+)?$/.test(matchedText)) {
      className = 'where-token where-token-number'
    } else if (WHERE_HIGHLIGHT_KEYWORDS.includes(upper)) {
      className = upper === 'NULL' || upper === 'TRUE' || upper === 'FALSE'
        ? 'where-token where-token-constant'
        : 'where-token where-token-keyword'
    }
    html += `<span class="${className}">${escapeHtml(matchedText)}</span>`
    cursor = matchIndex + matchedText.length
  }
  if (cursor < text.length) {
    html += escapeHtml(text.slice(cursor))
  }
  return html || null
}

const buildHighlightedHtml = (text: string, regex: RegExp): string | null => {
  if (text.length === 0) {
    return null
  }
  const matches = [...text.matchAll(regex)]
  if (matches.length === 0) {
    return null
  }
  let cursor = 0
  let html = ''
  for (const match of matches) {
    const matchIndex = match.index ?? -1
    const matchedText = match[0] ?? ''
    if (matchIndex < 0 || matchedText.length === 0) {
      continue
    }
    if (matchIndex > cursor) {
      html += escapeHtml(text.slice(cursor, matchIndex))
    }
    html += `<mark class="table-search-highlight">${escapeHtml(matchedText)}</mark>`
    cursor = matchIndex + matchedText.length
  }
  if (cursor < text.length) {
    html += escapeHtml(text.slice(cursor))
  }
  return html.length > 0 ? html : null
}

const buildPlainHighlightedHtml = (text: string, query: string, caseSensitive: boolean): string | null => {
  if (!query || !text) {
    return null
  }
  const sourceText = caseSensitive ? text : text.toLocaleLowerCase()
  const sourceQuery = caseSensitive ? query : query.toLocaleLowerCase()
  const queryLength = sourceQuery.length
  if (queryLength === 0) {
    return null
  }
  let cursor = 0
  let html = ''
  let found = false
  while (cursor < text.length) {
    const matchIndex = sourceText.indexOf(sourceQuery, cursor)
    if (matchIndex < 0) {
      break
    }
    found = true
    if (matchIndex > cursor) {
      html += escapeHtml(text.slice(cursor, matchIndex))
    }
    html += `<mark class="table-search-highlight">${escapeHtml(text.slice(matchIndex, matchIndex + queryLength))}</mark>`
    cursor = matchIndex + queryLength
  }
  if (!found) {
    return null
  }
  if (cursor < text.length) {
    html += escapeHtml(text.slice(cursor))
  }
  return html
}

const isDefaultValueMarker = (value: unknown): value is DefaultValueMarker => (
  value !== null
  && typeof value === 'object'
  && '__datadjinn_action__' in value
  && (value as DefaultValueMarker).__datadjinn_action__ === 'default'
)

const tableFilterValueKey = (value: unknown): string => {
  if (isDefaultValueMarker(value)) {
    return '__DATADJINN_DEFAULT__'
  }
  return value === null || value === undefined ? '__DATADJINN_NULL__' : String(value)
}

const tableFilterValueLabel = (value: string): string => {
  if (value === '__DATADJINN_NULL__') {
    return 'NULL'
  }
  if (value === '__DATADJINN_DEFAULT__') {
    return 'DEFAULT'
  }
  return value
}

const sortFilterOptions = (options: Array<{ value: string; label: string; count: number }>): Array<{ value: string; label: string; count: number }> =>
  options.sort((left, right) => left.label.localeCompare(right.label, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }))

const buildColumnFilterOptions = (rows: EditableRowLike[], column: string): Array<{ value: string; label: string; count: number }> => {
  const filterCounts = new Map<string, number>()
  for (const row of rows) {
    const valueKey = tableFilterValueKey(row[column])
    filterCounts.set(valueKey, (filterCounts.get(valueKey) ?? 0) + 1)
  }

  return sortFilterOptions([...filterCounts.entries()].map(([value, count]) => ({
    value,
    label: tableFilterValueLabel(value),
    count
  })))
}

export const createSearchMatcher = (query: string, options: {
  regex: boolean
  wholeWord: boolean
  caseSensitive: boolean
}): SearchMatcher | null => {
  const trimmedQuery = query.trim()
  if (!trimmedQuery) {
    return null
  }

  if (!options.regex && !options.wholeWord) {
    const normalizedQuery = options.caseSensitive ? trimmedQuery : trimmedQuery.toLocaleLowerCase()
    return {
      matches: (text: string) => {
        if (!text) {
          return false
        }
        const normalizedText = options.caseSensitive ? text : text.toLocaleLowerCase()
        return normalizedText.includes(normalizedQuery)
      },
      highlight: (text: string) => buildPlainHighlightedHtml(text, trimmedQuery, options.caseSensitive)
    }
  }

  try {
    const escaped = trimmedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const basePattern = options.regex ? trimmedQuery : escaped
    const source = options.wholeWord ? `\\b(?:${basePattern})\\b` : basePattern
    const testRegex = new RegExp(source, options.caseSensitive ? '' : 'i')
    if (testRegex.test('')) {
      return null
    }
    const highlightFlags = options.caseSensitive ? 'g' : 'gi'
    return {
      matches: (text: string) => {
        if (!text) {
          return false
        }
        testRegex.lastIndex = 0
        return testRegex.test(text)
      },
      highlight: (text: string) => {
        if (!text) {
          return null
        }
        return buildHighlightedHtml(text, new RegExp(source, highlightFlags))
      }
    }
  } catch {
    return null
  }
}

export const scheduleSelectionRenderSync = (callback: () => void): void => {
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      callback()
    })
  })
}

export const WhereClauseInput = memo(function WhereClauseInput({
  tabKey,
  columns,
  value,
  label,
  placeholder,
  disableSuggestions,
  onSubmit
}: {
  tabKey: string
  columns: string[]
  value?: string
  label?: string
  placeholder?: string
  disableSuggestions?: boolean
  onSubmit: (value: string) => void
}) {
  const [inputValue, setInputValue] = useState(value ?? '')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false)
  const inputRef = useRef<InputRef | null>(null)

  useEffect(() => {
    setInputValue(value ?? '')
    setHighlightedIndex(0)
    setSuggestionsDismissed(false)
  }, [tabKey, value])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const suggestionState = useMemo(() => {
    if (disableSuggestions) {
      return { token: '', start: -1, options: [] as string[] }
    }
    const match = /(^|[^A-Za-z0-9_"])([A-Za-z_][A-Za-z0-9_]*)$/.exec(inputValue)
    if (!match) {
      return { token: '', start: -1, options: [] as string[] }
    }

    const token = match[2] ?? ''
    if (!token.trim()) {
      return { token: '', start: -1, options: [] as string[] }
    }

    const lowerToken = token.toLowerCase()
    const options = columns
      .filter((column) => column !== '__rowKey' && column.toLowerCase().includes(lowerToken))
      .slice(0, 8)

    return {
      token,
      start: inputValue.length - token.length,
      options
    }
  }, [columns, inputValue, disableSuggestions])

  useEffect(() => {
    setHighlightedIndex((current) => {
      if (suggestionState.options.length <= 0) {
        return 0
      }
      return Math.min(current, suggestionState.options.length - 1)
    })
  }, [suggestionState.options])

  const applySuggestion = (nextColumn: string): void => {
    if (!nextColumn || suggestionState.start < 0) {
      return
    }
    const nextValue = `${inputValue.slice(0, suggestionState.start)}${nextColumn}`
    setInputValue(nextValue)
    setHighlightedIndex(0)
    setSuggestionsDismissed(true)
  }

  const suggestionsOpen = !suggestionsDismissed && suggestionState.options.length > 0
  const highlightedWhereHtml = useMemo(() => {
    if (!inputValue) {
      return ''
    }
    return buildWhereHighlightedHtml(inputValue) ?? escapeHtml(inputValue)
  }, [inputValue])

  const handleWhereInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (suggestionsOpen && event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((current) => (current + 1) % suggestionState.options.length)
      return
    }
    if (suggestionsOpen && event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((current) => (current - 1 + suggestionState.options.length) % suggestionState.options.length)
      return
    }
    if (suggestionsOpen && event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      applySuggestion(suggestionState.options[highlightedIndex] ?? suggestionState.options[0] ?? '')
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      onSubmit(inputValue)
    }
  }

  return (
    <div className="preview-where-shell">
      <div className="preview-where-inline">
        <span className="preview-where-label">{label ?? 'WHERE'}</span>
        <div className="preview-where-editor">
          {inputValue && (
            <span
              className="preview-where-highlight"
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: highlightedWhereHtml }}
            />
          )}
          <Input
            ref={inputRef}
            className="preview-where-field"
            size="small"
            variant="borderless"
            value={inputValue}
            placeholder={placeholder ?? '输入过滤条件，例如：id = 2，回车查询'}
            allowClear
            onChange={(event) => {
              setInputValue(event.currentTarget.value)
              setHighlightedIndex(0)
              setSuggestionsDismissed(false)
            }}
            onClear={() => {
              setInputValue('')
              setHighlightedIndex(0)
              setSuggestionsDismissed(false)
              requestAnimationFrame(() => {
                inputRef.current?.focus()
              })
            }}
            onKeyDown={handleWhereInputKeyDown}
            onPressEnter={() => undefined}
          />
        </div>
      </div>
      {suggestionsOpen && (
        <div className="preview-where-suggestions">
          {suggestionState.options.map((option, index) => (
            <button
              key={`${tabKey}-${option}`}
              type="button"
              className={index === highlightedIndex ? 'preview-where-option is-active' : 'preview-where-option'}
              onMouseDown={(event) => {
                event.preventDefault()
                applySuggestion(option)
              }}
            >
              {option}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}, (prev, next) => (
  prev.tabKey === next.tabKey &&
  prev.value === next.value &&
  prev.columns === next.columns
))

export const SearchHighlightedText = memo(function SearchHighlightedText({
  text,
  highlightedHtml,
  className
}: {
  text: string
  highlightedHtml?: string
  className?: string
}) {
  if (!highlightedHtml) {
    return className ? <span className={className}>{text}</span> : <>{text}</>
  }
  return <span className={className} dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
})

const PageSearchControls = memo(function PageSearchControls({
  state,
  matchCount,
  activeMatchIndex,
  onStateChange,
  onPrevious,
  onNext,
  onClearActiveHighlight,
  onRequestClose
}: {
  state: TableSearchUiStateLike
  matchCount: number
  activeMatchIndex: number
  onStateChange: (patch: Partial<TableSearchUiStateLike>) => void
  onPrevious: () => void
  onNext: () => void
  onClearActiveHighlight: () => void
  onRequestClose: () => void
}) {
  const [draftQuery, setDraftQuery] = useState(state.query)
  const composingRef = useRef(false)
  const skipNextDeferredSyncRef = useRef(false)
  const inputRef = useRef<InputRef | null>(null)

  useEffect(() => {
    setDraftQuery(state.query)
  }, [state.query])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      inputRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (skipNextDeferredSyncRef.current) {
      skipNextDeferredSyncRef.current = false
      return
    }
    if (composingRef.current || draftQuery === state.query) {
      return
    }
    const timer = window.setTimeout(() => {
      onClearActiveHighlight()
      startTransition(() => {
        onStateChange({
          query: draftQuery,
          activeMatchIndex: 0
        })
      })
    }, 120)
    return () => window.clearTimeout(timer)
  }, [draftQuery, onClearActiveHighlight, onStateChange, state.query])

  let hasRegexError = false
  if (state.regex && draftQuery.trim()) {
    try {
      const source = state.wholeWord ? `\\b(?:${draftQuery})\\b` : draftQuery
      const tester = new RegExp(source, state.caseSensitive ? 'g' : 'gi')
      tester.lastIndex = 0
      if (tester.test('')) {
        hasRegexError = true
      }
    } catch {
      hasRegexError = true
    }
  }

  return (
    <Flex align="center" gap={8} className="table-search-bar">
      <Input
        ref={inputRef}
        size="small"
        className="table-search-input"
        value={draftQuery}
        allowClear
        variant="borderless"
        status={hasRegexError ? 'error' : undefined}
        onChange={(event) => {
          setDraftQuery(event.target.value)
        }}
        onCompositionStart={() => {
          composingRef.current = true
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false
          const nextValue = event.currentTarget.value
          skipNextDeferredSyncRef.current = true
          setDraftQuery(nextValue)
          onClearActiveHighlight()
          startTransition(() => {
            onStateChange({
              query: nextValue,
              activeMatchIndex: 0
            })
          })
        }}
      />
      <Space size={4} className="table-search-nav">
        <Button
          size="small"
          type="text"
          className="table-search-icon-btn"
          icon={<UpOutlined />}
          title="上一个"
          aria-label="上一个"
          disabled={matchCount === 0 || hasRegexError}
          onClick={onPrevious}
        />
        <Button
          size="small"
          type="text"
          className="table-search-icon-btn"
          icon={<DownOutlined />}
          title="下一个"
          aria-label="下一个"
          disabled={matchCount === 0 || hasRegexError}
          onClick={onNext}
        />
        <Typography.Text type="secondary" className="table-search-counter">
          {matchCount > 0 ? `${activeMatchIndex + 1}/${matchCount}` : '0/0'}
        </Typography.Text>
      </Space>
      <Space size={4} className="table-search-options">
        <Button
          size="small"
          type="text"
          className={state.caseSensitive ? 'table-search-icon-btn table-search-option is-active' : 'table-search-icon-btn table-search-option'}
          title="区分大小写"
          aria-label="区分大小写"
          onClick={() => {
            onClearActiveHighlight()
            onStateChange({
              query: draftQuery,
              caseSensitive: !state.caseSensitive,
              activeMatchIndex: 0
            })
          }}
        >
          <span className="table-search-flag">Aa</span>
        </Button>
        <Button
          size="small"
          type="text"
          className={state.regex ? 'table-search-icon-btn table-search-option is-active' : 'table-search-icon-btn table-search-option'}
          title="正则表达式"
          aria-label="正则表达式"
          onClick={() => {
            onClearActiveHighlight()
            onStateChange({
              query: draftQuery,
              regex: !state.regex,
              activeMatchIndex: 0
            })
          }}
        >
          <span className="table-search-flag">.*</span>
        </Button>
        <Button
          size="small"
          type="text"
          className={state.wholeWord ? 'table-search-icon-btn table-search-option is-active' : 'table-search-icon-btn table-search-option'}
          title="整词匹配"
          aria-label="整词匹配"
          onClick={() => {
            onClearActiveHighlight()
            onStateChange({
              query: draftQuery,
              wholeWord: !state.wholeWord,
              activeMatchIndex: 0
            })
          }}
        >
          <span className="table-search-flag">W</span>
        </Button>
        <Button
          size="small"
          type="text"
          className={state.filterRows ? 'table-search-icon-btn table-search-option is-active' : 'table-search-icon-btn table-search-option'}
          title="只显示命中行"
          aria-label="只显示命中行"
          onClick={() => onStateChange({ query: draftQuery, filterRows: !state.filterRows, activeMatchIndex: 0 })}
        >
          <FilterOutlined />
        </Button>
        <Button
          size="small"
          type="text"
          className="table-search-icon-btn"
          icon={<CloseOutlined />}
          title="关闭搜索"
          aria-label="关闭搜索"
          onClick={() => {
            onClearActiveHighlight()
            onStateChange({ visible: false })
            onRequestClose()
          }}
        />
      </Space>
    </Flex>
  )
})

const LightweightPopover = memo(function LightweightPopover({
  open,
  anchorRef,
  onClose,
  children
}: {
  open: boolean
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  children: React.ReactNode
}) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number }>()

  useEffect(() => {
    if (!open) {
      return
    }

    const updatePosition = (): void => {
      const anchor = anchorRef.current
      if (!anchor) {
        return
      }
      const rect = anchor.getBoundingClientRect()
      setPosition({
        top: rect.bottom + window.scrollY + 6,
        left: Math.max(12, rect.right + window.scrollX - 240)
      })
    }

    updatePosition()
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('resize', updatePosition)

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) {
        return
      }
      onClose()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => {
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('pointerdown', handlePointerDown, true)
    }
  }, [anchorRef, onClose, open])

  if (!open || !position) {
    return null
  }

  return createPortal(
    <div
      ref={panelRef}
      className="lightweight-popover"
      style={{ top: position.top, left: position.left }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  )
})

export const ColumnFilterTrigger = memo(function ColumnFilterTrigger({
  column,
  checkedValues,
  sourceRows,
  onChange
}: {
  column: string
  checkedValues: string[]
  sourceRows: EditableRowLike[]
  onChange: (values: string[]) => void
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const options = useMemo(() => buildColumnFilterOptions(sourceRows, column), [column, sourceRows])
  const [draftValues, setDraftValues] = useState<string[]>(checkedValues)

  useEffect(() => {
    setDraftValues(checkedValues)
  }, [checkedValues])

  const allChecked = options.length > 0 && draftValues.length === options.length
  const partiallyChecked = draftValues.length > 0 && draftValues.length < options.length

  const applyFilterChange = (values: string[]): void => {
    setDraftValues(values)
    window.setTimeout(() => {
      onChange(values)
    }, 0)
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`column-filter-button${draftValues.length > 0 ? ' active' : ''}`}
        title="筛选本页数据"
        onClick={(event) => {
          event.stopPropagation()
          setOpen((current) => !current)
        }}
      >
        <FilterOutlined />
      </button>
      <LightweightPopover
        open={open}
        anchorRef={buttonRef}
        onClose={() => setOpen(false)}
      >
        <div className="column-filter-popover">
          <Space direction="vertical" className="column-filter-popover">
            <Typography.Text strong>{column} 筛选</Typography.Text>
            {options.length > 0 && (
              <Checkbox
                checked={allChecked}
                indeterminate={partiallyChecked}
                onChange={(event) => {
                  applyFilterChange(event.target.checked ? options.map((option) => option.value) : [])
                }}
              >
                全选
              </Checkbox>
            )}
            <Checkbox.Group value={draftValues} onChange={(values) => applyFilterChange(values.map(String))}>
              <Space direction="vertical" className="column-filter-options">
                {options.length > 0 ? options.map((option) => (
                  <Checkbox key={option.value} value={option.value}>
                    {option.label} <Typography.Text type="secondary">({option.count})</Typography.Text>
                  </Checkbox>
                )) : (
                  <Typography.Text type="secondary">暂无可筛选项</Typography.Text>
                )}
              </Space>
            </Checkbox.Group>
          </Space>
        </div>
      </LightweightPopover>
    </>
  )
})

export const ResultTableBodyView = memo(function ResultTableBodyView({
  tab,
  searchSignature,
  selectedRowKeyMap,
  tableColumns,
  tableRows,
  tableScrollX,
  tableScrollY,
  virtual,
  setTableRef,
  setBodyRef,
  setHeaderRef,
  onScrollCapture,
  onKeyDown,
  onMouseDown,
  onMouseUp,
  onMouseLeave
}: {
  tab: WorkspaceTabLike
  searchSignature: string
  selectedRowKeyMap: Record<string, true>
  tableColumns: ColumnsType<EditableRowLike>
  tableRows: EditableRowLike[]
  tableScrollX: number
  tableScrollY: number
  virtual: boolean
  setTableRef: (instance: TableRef | null) => void
  setBodyRef: (element: HTMLDivElement | null) => void
  setHeaderRef: (element: HTMLDivElement | null) => void
  onScrollCapture: () => void
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void
  onMouseUp: (event: React.MouseEvent<HTMLDivElement>) => void
  onMouseLeave: () => void
}) {
  void searchSignature
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const effectiveTableScrollY = tableScrollY

  return (
    <div
      ref={(element) => {
        bodyRef.current = element
        setBodyRef(element)
      }}
      className="result-table-body"
      tabIndex={0}
      style={{ '--result-table-scroll-y': `${effectiveTableScrollY}px` } as React.CSSProperties}
      onMouseEnter={(event) => {
        const currentTarget = event.currentTarget
        setHeaderRef(currentTarget.querySelector<HTMLDivElement>('.ant-table-header'))
      }}
      onScrollCapture={onScrollCapture}
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
    >
      <Table
        ref={setTableRef}
        key={tab.key}
        className="result-table"
        rowClassName={(row) => [
          row.__deleted ? 'row-deleted' : row.__state ? `row-${row.__state}` : '',
          selectedRowKeyMap[row.__rowKey] ? 'row-selected' : ''
        ].filter(Boolean).join(' ')}
        size="small"
        columns={tableColumns}
        dataSource={tableRows}
        rowKey="__rowKey"
        pagination={false}
        tableLayout="fixed"
        virtual={virtual}
        scroll={{ x: tableScrollX, y: effectiveTableScrollY }}
        locale={{ emptyText: tab.kind === 'query' ? '暂无查询结果' : '暂无表数据' }}
      />
    </div>
  )
}, (prev, next) => (
  prev.tab === next.tab
  && prev.searchSignature === next.searchSignature
  && prev.selectedRowKeyMap === next.selectedRowKeyMap
  && prev.tableScrollX === next.tableScrollX
  && prev.tableScrollY === next.tableScrollY
))

export const ResultTableHeader = memo(function ResultTableHeader({
  leftActions,
  whereInput,
  rightActions,
  searchState,
  searchMeta,
  onSearchStateChange,
  onClearActiveHighlight,
  searchVisible,
  onToggleSearch
}: {
  leftActions: React.ReactNode
  whereInput: React.ReactNode
  rightActions?: React.ReactNode
  searchState: TableSearchUiStateLike
  searchMeta: {
    matchCount: number
    resetKey: string
    focusSearchMatch: (matchIndex: number) => void
  }
  onSearchStateChange: (patch: Partial<TableSearchUiStateLike>) => void
  onClearActiveHighlight: () => void
  searchVisible: boolean
  onToggleSearch: () => void
}) {
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)
  const hasToolbarContent = Boolean(leftActions || whereInput || rightActions)

  useEffect(() => {
    setActiveMatchIndex(0)
  }, [searchMeta.resetKey])

  useEffect(() => {
    setActiveMatchIndex((current) => {
      if (searchMeta.matchCount <= 0) {
        return 0
      }
      return Math.min(Math.max(current, 0), searchMeta.matchCount - 1)
    })
  }, [searchMeta.matchCount])

  return (
    <>
      {hasToolbarContent && (
        <Flex align="center" justify="space-between" gap={8} className="table-data-toolbar">
          {leftActions}
          <Flex align="center" justify="end" gap={8} className="table-data-toolbar-right">
            {whereInput}
            {rightActions}
          </Flex>
        </Flex>
      )}
      {searchVisible && (
        <PageSearchControls
          state={searchState}
          matchCount={searchMeta.matchCount}
          activeMatchIndex={activeMatchIndex}
          onStateChange={onSearchStateChange}
          onPrevious={() => {
            if (searchMeta.matchCount === 0) {
              return
            }
            const nextIndex = activeMatchIndex <= 0 ? searchMeta.matchCount - 1 : activeMatchIndex - 1
            setActiveMatchIndex(nextIndex)
            searchMeta.focusSearchMatch(nextIndex)
          }}
          onNext={() => {
            if (searchMeta.matchCount === 0) {
              return
            }
            const nextIndex = activeMatchIndex >= searchMeta.matchCount - 1 ? 0 : activeMatchIndex + 1
            setActiveMatchIndex(nextIndex)
            searchMeta.focusSearchMatch(nextIndex)
          }}
          onClearActiveHighlight={onClearActiveHighlight}
          onRequestClose={onToggleSearch}
        />
      )}
    </>
  )
})
