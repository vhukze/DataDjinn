import Editor, { loader, OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import * as monaco from 'monaco-editor'
import { useEffect, useRef } from 'react'
import { format as formatSqlText } from 'sql-formatter'
import type { SqlLanguage } from 'sql-formatter'

loader.config({ monaco })

monaco.editor.defineTheme('datadjinn-light', {
  base: 'vs',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#00000000',
    'editor.lineHighlightBackground': '#00000000',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#3c82ff66',
    'editor.inactiveSelectionBackground': '#3c82ff4d',
    'editor.selectionHighlightBackground': '#00000000',
    'editor.selectionHighlightBorder': '#00000000',
    'editor.hoverHighlightBackground': '#00000000',
    'editor.rangeHighlightBackground': '#00000000',
    'editor.rangeHighlightBorder': '#00000000',
    'editor.wordHighlightBackground': '#00000000',
    'editor.wordHighlightBorder': '#00000000',
    'editor.wordHighlightStrongBackground': '#00000000',
    'editor.wordHighlightStrongBorder': '#00000000',
    'editorOverviewRuler.border': '#00000000'
  }
})

monaco.editor.defineTheme('datadjinn-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#00000000',
    'editor.lineHighlightBackground': '#00000000',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#68a1ff7f',
    'editor.inactiveSelectionBackground': '#68a1ff59',
    'editor.selectionHighlightBackground': '#00000000',
    'editor.selectionHighlightBorder': '#00000000',
    'editor.hoverHighlightBackground': '#00000000',
    'editor.rangeHighlightBackground': '#00000000',
    'editor.rangeHighlightBorder': '#00000000',
    'editor.wordHighlightBackground': '#00000000',
    'editor.wordHighlightBorder': '#00000000',
    'editor.wordHighlightStrongBackground': '#00000000',
    'editor.wordHighlightStrongBorder': '#00000000',
    'editorOverviewRuler.border': '#00000000'
  }
})

export type SqlDialect =
  | 'sqlite'
  | 'mysql'
  | 'postgresql'
  | 'dm'
  | 'gaussdb'
  | 'oracle'
  | 'mongodb'
  | 'redis'
  | 'clickhouse'

export interface SqlCompletionColumn {
  name: string
  type?: string
  tableName?: string
  databaseName?: string
  schemaName?: string
  nullable?: boolean
  primaryKey?: boolean
}

export interface SqlCompletionTable {
  name: string
  databaseName?: string
  schemaName?: string
  columns?: SqlCompletionColumn[]
}

export interface SqlCompletionRoutine {
  name: string
  type: 'procedure' | 'function'
  databaseName?: string
  schemaName?: string
}

export interface SqlCompletionContext {
  dialect?: SqlDialect
  connectionId?: string
  databaseName?: string
  pgDatabaseName?: string
  schemaName?: string
  databases?: string[]
  schemas?: string[]
  tables?: SqlCompletionTable[]
  columns?: SqlCompletionColumn[]
  routines?: SqlCompletionRoutine[]
  loadRoutines?: () => Promise<SqlCompletionRoutine[]>
  loadTableColumns?: (tableNames: string[]) => Promise<SqlCompletionColumn[]>
}

export interface SqlStatementInfo {
  text: string
  start: number
  end: number
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export interface SqlEditorSelectionPayload {
  selectedSql: string
  currentStatementSql: string
  statements: SqlStatementInfo[]
  currentStatementIndex: number
}

export interface SqlEditorHandle {
  getSelectionPayload: () => SqlEditorSelectionPayload
  getValue: () => string
  formatSelectionOrStatement: () => void
}

interface SqlEditorProps {
  value: string
  onChange?: (value: string) => void
  onExecute?: (payload: SqlEditorSelectionPayload & { sql?: string }) => void
  onSelectionChange?: (payload: SqlEditorSelectionPayload) => void
  onReady?: (handle: SqlEditorHandle | null) => void
  theme: 'dark' | 'light'
  completionContext?: SqlCompletionContext
  readOnly?: boolean
  height?: string
  shortcuts?: {
    execute?: string
    deleteLine?: string
    duplicateLineDown?: string
  }
}

const COMMON_KEYWORDS = [
  'SELECT',
  'FROM',
  'WHERE',
  'INSERT',
  'INSERT INTO',
  'UPDATE',
  'DELETE',
  'CREATE',
  'ALTER',
  'DROP',
  'JOIN',
  'LEFT JOIN',
  'RIGHT JOIN',
  'INNER JOIN',
  'OUTER JOIN',
  'ON',
  'AS',
  'AND',
  'OR',
  'NOT',
  'IN',
  'EXISTS',
  'BETWEEN',
  'LIKE',
  'IS NULL',
  'IS NOT NULL',
  'ORDER BY',
  'GROUP BY',
  'HAVING',
  'LIMIT',
  'OFFSET',
  'UNION',
  'DISTINCT',
  'COUNT',
  'SUM',
  'AVG',
  'MAX',
  'MIN',
  'CASE',
  'WHEN',
  'THEN',
  'ELSE',
  'END',
  'NULL',
  'TRUE',
  'FALSE',
  'PRIMARY KEY',
  'FOREIGN KEY',
  'REFERENCES',
  'INDEX',
  'UNIQUE',
  'DEFAULT',
  'CHECK',
  'CONSTRAINT',
  'TABLE',
  'DATABASE',
  'SCHEMA',
  'VIEW',
  'CHAR',
  'VARCHAR',
  'INT',
  'INTEGER',
  'BIGINT',
  'DECIMAL',
  'TEXT',
  'BOOLEAN',
  'DATE',
  'TIMESTAMP',
  'FLOAT',
  'DOUBLE',
  'BLOB',
  'BEGIN',
  'COMMIT',
  'ROLLBACK',
  'CALL',
  'EXEC',
  'EXECUTE',
  'PROCEDURE',
  'FUNCTION'
]

const DIALECT_KEYWORDS: Record<SqlDialect, string[]> = {
  sqlite: ['AUTOINCREMENT', 'WITHOUT ROWID', 'PRAGMA', 'RETURNING'],
  mysql: ['AUTO_INCREMENT', 'ENGINE', 'UNSIGNED', 'SHOW DATABASES', 'SHOW TABLES', 'DESCRIBE'],
  postgresql: ['SERIAL', 'BIGSERIAL', 'RETURNING', 'ILIKE', 'ON CONFLICT', 'JSONB', 'UUID'],
  dm: ['ROWNUM', 'CONNECT BY', 'START WITH', 'SYSDATE', 'SYSTIMESTAMP', 'NVL', 'DECODE', 'DUAL'],
  gaussdb: [
    'SERIAL',
    'BIGSERIAL',
    'RETURNING',
    'ILIKE',
    'ON CONFLICT',
    'JSONB',
    'UUID',
    'DISTRIBUTE BY',
    'PARTITION BY'
  ],
  oracle: [
    'ROWNUM',
    'CONNECT BY',
    'START WITH',
    'SYSDATE',
    'SYSTIMESTAMP',
    'NVL',
    'DECODE',
    'DUAL',
    'MERGE',
    'SEQUENCE'
  ],
  mongodb: [
    'db',
    'find',
    'aggregate',
    'countDocuments',
    'distinct',
    'sort',
    'limit',
    'skip',
    'ObjectId'
  ],
  redis: [
    'SCAN',
    'KEYS',
    'GET',
    'SET',
    'HGETALL',
    'HSET',
    'LRANGE',
    'LPUSH',
    'RPUSH',
    'SMEMBERS',
    'SADD',
    'ZRANGE',
    'ZADD',
    'DEL',
    'EXPIRE',
    'TTL',
    'TYPE'
  ],
  clickhouse: [
    'MergeTree',
    'ReplacingMergeTree',
    'ORDER BY',
    'PARTITION BY',
    'UInt8',
    'UInt32',
    'UInt64',
    'Int64',
    'String',
    'DateTime',
    'Nullable',
    'SHOW CREATE TABLE',
    'DESCRIBE TABLE'
  ]
}

const TABLE_CONTEXT_KEYWORDS = ['FROM', 'JOIN', 'UPDATE', 'INTO']
const COLUMN_CONTEXT_KEYWORDS = ['SELECT', 'WHERE', 'ON', 'ORDER BY', 'GROUP BY', 'HAVING', 'SET']
const SQL_KEYWORDS = new Set([...COMMON_KEYWORDS, ...Object.values(DIALECT_KEYWORDS).flat()])

const uniqueBy = <T,>(items: T[], keyOf: (item: T) => string): T[] => {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = keyOf(item).toLowerCase()
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

const quoteIdentifier = (name: string, dialect?: SqlDialect): string => {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    return name
  }

  if (
    dialect === 'postgresql' ||
    dialect === 'dm' ||
    dialect === 'gaussdb' ||
    dialect === 'oracle'
  ) {
    return `"${name.replaceAll('"', '""')}"`
  }

  return `\`${name.replaceAll('`', '``')}\``
}

const getTextBeforePosition = (
  model: Monaco.editor.ITextModel,
  position: Monaco.Position
): string => {
  const range = {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column
  }
  return model.getValueInRange(range)
}

const getCompletionMode = (text: string): 'table' | 'column' | 'all' => {
  const normalized = text.toUpperCase().replace(/\s+/g, ' ')
  const candidates = [...TABLE_CONTEXT_KEYWORDS, ...COLUMN_CONTEXT_KEYWORDS]
    .map((keyword) => ({ keyword, index: normalized.lastIndexOf(keyword) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => b.index - a.index)

  const latest = candidates[0]?.keyword
  if (latest && TABLE_CONTEXT_KEYWORDS.includes(latest)) {
    return 'table'
  }
  if (latest && COLUMN_CONTEXT_KEYWORDS.includes(latest)) {
    return 'column'
  }
  return 'all'
}

const isRoutineCallContext = (text: string): boolean => /\b(?:CALL|EXEC(?:UTE)?)\s+[^\s;()]*$/i.test(text)

const getDotQualifier = (text: string): string | undefined => {
  const match = text.match(/([A-Za-z_][\w$]*|`[^`]+`|"[^"]+")\.$/)
  return match?.[1]?.replace(/^`|`$/g, '').replace(/^"|"$/g, '')
}

type StatementTableReference = {
  tableName: string
  qualifier: string
}

const unquoteIdentifier = (value: string): string =>
  value.trim().replace(/^`|`$/g, '').replace(/^"|"$/g, '').replace(/^\[|\]$/g, '')

const getStatementTextAtOffset = (sql: string, offset: number): string => {
  const statements = splitSqlStatements(sql)
  return (
    statements.find((statement) => offset >= statement.start && offset <= statement.end)?.text ??
    statements.at(-1)?.text ??
    sql
  )
}

const getStatementTableReferences = (statementText: string): StatementTableReference[] => {
  const references: StatementTableReference[] = []
  const identifier = '(?:`[^`]+`|"[^"]+"|\\[[^\\]]+\\]|[A-Za-z_][\\w$]*)'
  const pattern = new RegExp(
    `\\b(?:FROM|JOIN)\\s+(${identifier}(?:\\s*\\.\\s*${identifier}){0,2})(?:\\s+(?:AS\\s+)?([A-Za-z_][\\w$]*))?`,
    'gi'
  )

  for (const match of statementText.matchAll(pattern)) {
    const segments = match[1]
      .split('.')
      .map(unquoteIdentifier)
      .filter(Boolean)
    const tableName = segments.at(-1)
    if (!tableName) {
      continue
    }
    const alias = match[2]
    references.push({ tableName, qualifier: tableName })
    if (alias && !SQL_KEYWORDS.has(alias.toUpperCase())) {
      references.push({ tableName, qualifier: alias })
    }
  }

  return uniqueBy(references, (reference) => `${reference.tableName}.${reference.qualifier}`)
}

const toEditorTheme = (theme: 'dark' | 'light'): 'datadjinn-dark' | 'datadjinn-light' =>
  theme === 'dark' ? 'datadjinn-dark' : 'datadjinn-light'

const findExecutableSqlOffset = (sql: string): number => {
  let index = 0

  while (index < sql.length) {
    while (index < sql.length && /\s/.test(sql[index])) {
      index += 1
    }

    if (sql[index] === '-' && sql[index + 1] === '-') {
      const lineEnd = sql.indexOf('\n', index + 2)
      if (lineEnd < 0) {
        return -1
      }
      index = lineEnd + 1
      continue
    }

    return index < sql.length && sql[index] !== ';' ? index : -1
  }

  return -1
}

export const splitSqlStatements = (sql: string): { text: string; start: number; end: number }[] => {
  const statements: { text: string; start: number; end: number }[] = []
  const implicitStatementStarters = new Set([
    'SELECT',
    'WITH',
    'INSERT',
    'UPDATE',
    'DELETE',
    'MERGE',
    'CALL',
    'EXEC',
    'SHOW',
    'DESCRIBE',
    'EXPLAIN'
  ])
  let quote: "'" | '"' | '`' | null = null
  let lineComment = false
  let blockCommentDepth = 0
  let parenthesesDepth = 0
  let dollarQuoteTag: string | null = null
  let alternativeQuoteEnd: string | null = null
  let start = 0

  const appendStatement = (end: number): void => {
    const raw = sql.slice(start, end)
    const executableOffset = findExecutableSqlOffset(raw)
    if (executableOffset < 0) {
      return
    }
    const executableSql = raw.slice(executableOffset)
    const trimmedEndOffset = executableSql.length - executableSql.trimEnd().length
    statements.push({
      text: executableSql.trimEnd(),
      start: start + executableOffset,
      end: end - trimmedEndOffset
    })
  }

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]
    const next = sql[index + 1]

    if (lineComment) {
      if (char === '\n') {
        lineComment = false
      }
      continue
    }

    if (blockCommentDepth > 0) {
      if (char === '/' && next === '*') {
        blockCommentDepth += 1
        index += 1
      } else if (char === '*' && next === '/') {
        blockCommentDepth -= 1
        index += 1
      }
      continue
    }

    if (dollarQuoteTag) {
      if (sql.startsWith(dollarQuoteTag, index)) {
        index += dollarQuoteTag.length - 1
        dollarQuoteTag = null
      }
      continue
    }

    if (alternativeQuoteEnd) {
      if (char === alternativeQuoteEnd && next === "'") {
        alternativeQuoteEnd = null
        index += 1
      }
      continue
    }

    if (quote) {
      if ((quote === "'" || quote === '"') && char === '\\' && next) {
        index += 1
      } else if (char === quote) {
        if ((quote === "'" || quote === '"') && next === quote) {
          index += 1
          continue
        }
        quote = null
      }
      continue
    }

    if ((char === '-' && next === '-') || char === '#') {
      lineComment = true
      if (next === '-') {
        index += 1
      }
      continue
    }

    if (char === '/' && next === '*') {
      blockCommentDepth = 1
      index += 1
      continue
    }

    if ((char === 'q' || char === 'Q') && next === "'" && sql[index + 2]) {
      const opener = sql[index + 2]
      alternativeQuoteEnd =
        opener === '['
          ? ']'
          : opener === '{'
            ? '}'
            : opener === '('
              ? ')'
              : opener === '<'
                ? '>'
                : opener
      index += 2
      continue
    }

    if (char === '$') {
      const dollarTag = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)?.[0]
      if (dollarTag) {
        dollarQuoteTag = dollarTag
        index += dollarTag.length - 1
        continue
      }
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }

    if (char === '(') {
      parenthesesDepth += 1
      continue
    }

    if (char === ')') {
      parenthesesDepth = Math.max(0, parenthesesDepth - 1)
      continue
    }

    if (char === '\n' && parenthesesDepth === 0) {
      const currentSql = sql.slice(start, index)
      const currentOffset = findExecutableSqlOffset(currentSql)
      const currentKeyword =
        currentOffset >= 0
          ? currentSql.slice(currentOffset).match(/^([A-Za-z]+)/)?.[1]?.toUpperCase()
          : undefined
      const nextLine = sql.slice(index + 1)
      const nextMatch = nextLine.match(/^[\t ]*([A-Za-z]+)/)
      const nextKeyword = nextMatch?.[1]?.toUpperCase()
      if (
        currentKeyword &&
        nextKeyword &&
        implicitStatementStarters.has(currentKeyword) &&
        implicitStatementStarters.has(nextKeyword)
      ) {
        appendStatement(index)
        start = index + 1 + (nextMatch?.[0].length ?? 0) - nextMatch![1].length
      }
      continue
    }

    if (char === ';') {
      appendStatement(index + 1)
      start = index + 1
    }
  }

  appendStatement(sql.length)

  return statements
}

const buildStatementInfos = (model: Monaco.editor.ITextModel): SqlStatementInfo[] => {
  const fullSql = model.getValue()
  return splitSqlStatements(fullSql).map((statement) => {
    const startPosition = model.getPositionAt(statement.start)
    const normalizedEnd = Math.max(statement.start + 1, statement.end)
    const endPosition = model.getPositionAt(normalizedEnd)
    return {
      ...statement,
      startLineNumber: startPosition.lineNumber,
      startColumn: startPosition.column,
      endLineNumber: endPosition.lineNumber,
      endColumn: endPosition.column
    }
  })
}

const normalizeShortcut = (shortcut?: string): string =>
  shortcut?.replace(/\s+/g, '').toLowerCase() ?? ''
const CONTENT_SYNC_DEBOUNCE_MS = 220

const SQL_FORMATTER_LANGUAGE: Record<SqlDialect, SqlLanguage> = {
  sqlite: 'sqlite',
  mysql: 'mysql',
  postgresql: 'postgresql',
  dm: 'plsql',
  gaussdb: 'postgresql',
  oracle: 'plsql',
  mongodb: 'sql',
  redis: 'sql',
  clickhouse: 'clickhouse'
}

const formatSql = (sql: string, dialect: SqlDialect = 'sqlite'): string => {
  if (!sql.trim()) {
    return sql
  }

  try {
    return formatSqlText(sql, {
      language: SQL_FORMATTER_LANGUAGE[dialect],
      keywordCase: 'upper',
      tabWidth: 2,
      linesBetweenQueries: 1
    })
  } catch {
    return sql
  }
}

const parseKeybinding = (shortcut?: string): number | null => {
  const normalized = normalizeShortcut(shortcut)
  if (!normalized) {
    return null
  }

  const parts = normalized.split('+').filter(Boolean)
  let binding = 0
  let keyCode: number | null = null

  for (const part of parts) {
    if (part === 'ctrl' || part === 'cmd' || part === 'ctrlcmd') {
      binding |= monaco.KeyMod.CtrlCmd
      continue
    }
    if (part === 'shift') {
      binding |= monaco.KeyMod.Shift
      continue
    }
    if (part === 'alt' || part === 'option') {
      binding |= monaco.KeyMod.Alt
      continue
    }
    if (part === 'enter') {
      keyCode = monaco.KeyCode.Enter
      continue
    }
    if (part === 'arrowdown') {
      keyCode = monaco.KeyCode.DownArrow
      continue
    }
    if (part === 'd') {
      keyCode = monaco.KeyCode.KeyD
      continue
    }
    if (part.length === 1 && /^[a-z]$/.test(part)) {
      keyCode = monaco.KeyCode[`Key${part.toUpperCase()}` as keyof typeof monaco.KeyCode] as number
      continue
    }
    return null
  }

  return keyCode == null ? null : binding | keyCode
}

function SqlEditor({
  value,
  onChange,
  onExecute,
  onSelectionChange,
  onReady,
  theme,
  completionContext,
  readOnly = false,
  height = '100%',
  shortcuts
}: SqlEditorProps): React.JSX.Element {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const completionDisposableRef = useRef<Monaco.IDisposable | null>(null)
  const contextRef = useRef<SqlCompletionContext | undefined>(completionContext)
  const executeRef = useRef<
    ((payload: SqlEditorSelectionPayload & { sql?: string }) => void) | undefined
  >(onExecute)
  const selectionChangeRef = useRef<((payload: SqlEditorSelectionPayload) => void) | undefined>(
    onSelectionChange
  )
  const readyRef = useRef<((handle: SqlEditorHandle | null) => void) | undefined>(onReady)
  const statementDecorationIdsRef = useRef<string[]>([])
  const statementExecuteDecorationIdsRef = useRef<string[]>([])
  const callKeywordDecorationIdsRef = useRef<string[]>([])
  const statementExecuteDecorationKeyRef = useRef('')
  const lastSelectionDispatchKeyRef = useRef('')
  const editorSelectionSyncFrameRef = useRef<number | undefined>(undefined)
  const editorContentSyncTimeoutRef = useRef<number | undefined>(undefined)
  const routineCompletionTimeoutRef = useRef<number | undefined>(undefined)
  const editorLayoutFrameRef = useRef<number | undefined>(undefined)
  const latestValueRef = useRef(value)
  const cachedStatementsRef = useRef<{
    model: Monaco.editor.ITextModel | null
    versionId: number
    statements: SqlStatementInfo[]
  }>({
    model: null,
    versionId: -1,
    statements: []
  })
  const activeStatementKeyRef = useRef('')

  useEffect(() => {
    contextRef.current = completionContext
  }, [completionContext])

  useEffect(() => {
    executeRef.current = onExecute
  }, [onExecute])

  useEffect(() => {
    selectionChangeRef.current = onSelectionChange
  }, [onSelectionChange])

  useEffect(() => {
    readyRef.current = onReady
  }, [onReady])

  useEffect(() => {
    const monacoInstance = monacoRef.current
    if (!monacoInstance || !editorRef.current) {
      return
    }
    monacoInstance.editor.setTheme(toEditorTheme(theme))
  }, [theme])

  useEffect(() => {
    return () => {
      if (editorSelectionSyncFrameRef.current) {
        window.cancelAnimationFrame(editorSelectionSyncFrameRef.current)
        editorSelectionSyncFrameRef.current = undefined
      }
      if (editorContentSyncTimeoutRef.current) {
        window.clearTimeout(editorContentSyncTimeoutRef.current)
        editorContentSyncTimeoutRef.current = undefined
      }
      if (routineCompletionTimeoutRef.current) {
        window.clearTimeout(routineCompletionTimeoutRef.current)
        routineCompletionTimeoutRef.current = undefined
      }
      if (editorLayoutFrameRef.current) {
        window.cancelAnimationFrame(editorLayoutFrameRef.current)
        editorLayoutFrameRef.current = undefined
      }
      readyRef.current?.(null)
      completionDisposableRef.current?.dispose()
      completionDisposableRef.current = null
      const editor = editorRef.current
      if (editor) {
        editor.deltaDecorations(statementDecorationIdsRef.current, [])
        editor.deltaDecorations(statementExecuteDecorationIdsRef.current, [])
        editor.deltaDecorations(callKeywordDecorationIdsRef.current, [])
      }
      statementExecuteDecorationKeyRef.current = ''
    }
  }, [])

  useEffect(() => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model) {
      return
    }
    const currentValue = model.getValue()
    if (currentValue === value) {
      return
    }
    latestValueRef.current = value
    const selection = editor.getSelection()
    model.pushEditOperations(
      selection ? [selection] : [],
      [
        {
          range: model.getFullModelRange(),
          text: value
        }
      ],
      () => (selection ? [selection] : null)
    )
    scheduleEditorContentSync(editor)
  }, [value])

  const registerCompletionProvider = (monaco: typeof Monaco): void => {
    completionDisposableRef.current?.dispose()
    completionDisposableRef.current = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: [' ', '.', ',', '('],
      provideCompletionItems: async (model, position) => {
        const context = contextRef.current ?? {}
        const word = model.getWordUntilPosition(position)
        const range: Monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: word.endColumn
        }
        const textBefore = getTextBeforePosition(model, position)
        const mode = getCompletionMode(textBefore)
        const routineCallContext = isRoutineCallContext(textBefore)
        const qualifier = getDotQualifier(textBefore)
        const statementTables = getStatementTableReferences(
          getStatementTextAtOffset(model.getValue(), model.getOffsetAt(position))
        )
        const suggestions: Monaco.languages.CompletionItem[] = []
        const keywordSort = mode === 'all' ? '1' : '4'
        const tableSort = mode === 'table' ? '0' : '2'
        const columnSort = mode === 'column' || qualifier ? '0' : '3'
        const routineSort = routineCallContext ? '0' : '3'

        for (const keyword of uniqueBy(
          [...COMMON_KEYWORDS, ...DIALECT_KEYWORDS[context.dialect ?? 'sqlite']],
          (item) => item
        )) {
          suggestions.push({
            label: keyword,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: keyword,
            sortText: `${keywordSort}_${keyword}`,
            range
          })
        }

        const tables = uniqueBy(
          context.tables ?? [],
          (table) => `${table.databaseName ?? ''}.${table.schemaName ?? ''}.${table.name}`
        )
        const qualifiedTables = qualifier
          ? tables.filter(
              (table) => table.schemaName === qualifier || table.databaseName === qualifier
            )
          : tables
        for (const table of qualifiedTables) {
          suggestions.push({
            label: table.name,
            kind: monaco.languages.CompletionItemKind.Struct,
            insertText: quoteIdentifier(table.name, context.dialect),
            detail: [table.schemaName, table.databaseName].filter(Boolean).join('.') || '表',
            sortText: `${tableSort}_${table.name}`,
            range
          })
        }

        const loadedRoutines =
          routineCallContext && context.loadRoutines ? await context.loadRoutines() : []
        const routines = uniqueBy(
          [...(context.routines ?? []), ...loadedRoutines],
          (routine) =>
            `${routine.databaseName ?? ''}.${routine.schemaName ?? ''}.${routine.type}.${routine.name}`
        ).filter((routine) => !routineCallContext || routine.type === 'procedure')
        for (const routine of routines) {
          suggestions.push({
            label: routine.name,
            kind:
              routine.type === 'procedure'
                ? monaco.languages.CompletionItemKind.Method
                : monaco.languages.CompletionItemKind.Function,
            insertText: quoteIdentifier(routine.name, context.dialect),
            detail: routine.type === 'procedure' ? '存储过程' : '函数',
            sortText: `${routineSort}_${routine.name}`,
            range
          })
        }

        const tableColumns = tables.flatMap((table) => table.columns ?? [])
        const referencedTableNames = uniqueBy(
          statementTables.map((reference) => reference.tableName),
          (tableName) => tableName
        )
        const loadedColumns =
          mode === 'column' && referencedTableNames.length > 0 && context.loadTableColumns
            ? await context.loadTableColumns(referencedTableNames)
            : []
        const columns = uniqueBy(
          [...(context.columns ?? []), ...tableColumns, ...loadedColumns],
          (column) =>
            `${column.databaseName ?? ''}.${column.schemaName ?? ''}.${column.tableName ?? ''}.${column.name}`
        )
        const qualifiedTableNames = qualifier
          ? new Set(
              statementTables
                .filter((reference) => reference.qualifier.toLowerCase() === qualifier.toLowerCase())
                .map((reference) => reference.tableName.toLowerCase())
            )
          : new Set(referencedTableNames.map((tableName) => tableName.toLowerCase()))
        const qualifiedColumns = columns.filter((column) => {
          if (!column.tableName) {
            return !qualifier && referencedTableNames.length === 0
          }
          return qualifiedTableNames.has(column.tableName.toLowerCase())
        })
        for (const column of qualifiedColumns) {
          suggestions.push({
            label: column.name,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: quoteIdentifier(column.name, context.dialect),
            detail: [column.tableName, column.type].filter(Boolean).join(' · ') || '字段',
            sortText: `${columnSort}_${column.name}`,
            range
          })
        }

        return { suggestions }
      }
    })
  }

  const getSelectedSql = (editor: Monaco.editor.IStandaloneCodeEditor): string => {
    const selection = editor.getSelection()
    const model = editor.getModel()
    if (!selection || !model || selection.isEmpty()) {
      return ''
    }

    return model.getValueInRange(selection).trim()
  }

  const getCurrentStatementInfo = (
    editor: Monaco.editor.IStandaloneCodeEditor,
    knownStatements?: SqlStatementInfo[]
  ): SqlStatementInfo | null => {
    const model = editor.getModel()
    const position = editor.getPosition()
    if (!model || !position) {
      return null
    }

    const statements = knownStatements ?? buildStatementInfos(model)
    if (statements.length === 0) {
      return null
    }

    const offset = model.getOffsetAt(position)
    for (let index = 0; index < statements.length; index += 1) {
      const statement = statements[index]
      if (offset >= statement.start && offset < statement.end) {
        return statement
      }
      const nextStatement = statements[index + 1]
      if (offset === statement.end && (!nextStatement || offset < nextStatement.start)) {
        return statement
      }
      if (offset > statement.end && (!nextStatement || offset < nextStatement.start)) {
        return statement
      }
    }

    return statements[0] ?? null
  }

  const buildSelectionPayload = (
    editor: Monaco.editor.IStandaloneCodeEditor,
    knownStatements?: SqlStatementInfo[],
    knownCurrentStatement?: SqlStatementInfo | null,
    includeSelectedSql = true
  ): SqlEditorSelectionPayload => {
    const model = editor.getModel()
    const statements = knownStatements ?? (model ? buildStatementInfos(model) : [])
    const currentStatement =
      knownCurrentStatement === undefined
        ? getCurrentStatementInfo(editor, statements)
        : knownCurrentStatement
    const currentStatementIndex = currentStatement
      ? statements.findIndex(
          (statement) =>
            statement.start === currentStatement.start && statement.end === currentStatement.end
        )
      : -1

    return {
      selectedSql: includeSelectedSql ? getSelectedSql(editor) : '',
      currentStatementSql: currentStatement?.text ?? '',
      statements,
      currentStatementIndex
    }
  }

  const getCachedStatements = (model: Monaco.editor.ITextModel | null): SqlStatementInfo[] => {
    if (!model) {
      cachedStatementsRef.current = {
        model: null,
        versionId: -1,
        statements: []
      }
      return []
    }

    const versionId = model.getVersionId()
    const cached = cachedStatementsRef.current
    if (cached.model === model && cached.versionId === versionId) {
      return cached.statements
    }

    const statements = buildStatementInfos(model)
    cachedStatementsRef.current = {
      model,
      versionId,
      statements
    }
    return statements
  }

  const getStatementIdentity = (statement: SqlStatementInfo | null | undefined): string =>
    statement ? `${statement.start}:${statement.end}` : ''

  const updateStatementDecorations = (
    editor: Monaco.editor.IStandaloneCodeEditor,
    knownCurrentStatement?: SqlStatementInfo | null
  ): void => {
    const monacoInstance = monacoRef.current
    const model = editor.getModel()
    if (!monacoInstance || !model) {
      return
    }

    const currentStatement =
      knownCurrentStatement === undefined ? getCurrentStatementInfo(editor) : knownCurrentStatement
    if (!currentStatement) {
      statementDecorationIdsRef.current = editor.deltaDecorations(
        statementDecorationIdsRef.current,
        []
      )
      return
    }

    const nextDecorations: Monaco.editor.IModelDeltaDecoration[] = []
    for (
      let lineNumber = currentStatement.startLineNumber;
      lineNumber <= currentStatement.endLineNumber;
      lineNumber += 1
    ) {
      const isFirstLine = lineNumber === currentStatement.startLineNumber
      const isLastLine = lineNumber === currentStatement.endLineNumber
      const lineClassName =
        isFirstLine && isLastLine
          ? 'sql-editor-active-statement-inline sql-editor-active-statement-inline-single'
          : isFirstLine
            ? 'sql-editor-active-statement-inline sql-editor-active-statement-inline-start'
            : isLastLine
              ? 'sql-editor-active-statement-inline sql-editor-active-statement-inline-end'
              : 'sql-editor-active-statement-inline sql-editor-active-statement-inline-middle'
      const startColumn = isFirstLine ? currentStatement.startColumn : 1
      const endColumn = isLastLine ? currentStatement.endColumn : model.getLineMaxColumn(lineNumber)
      if (endColumn <= startColumn) {
        continue
      }
      nextDecorations.push({
        range: new monacoInstance.Range(lineNumber, startColumn, lineNumber, endColumn),
        options: {
          className: lineClassName,
          shouldFillLineOnLineBreak: true,
          stickiness: monacoInstance.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
        }
      })
    }

    statementDecorationIdsRef.current = editor.deltaDecorations(
      statementDecorationIdsRef.current,
      nextDecorations
    )
  }

  const updateStatementExecuteDecorations = (
    editor: Monaco.editor.IStandaloneCodeEditor,
    statements: SqlStatementInfo[]
  ): void => {
    const monacoInstance = monacoRef.current
    const model = editor.getModel()
    if (!monacoInstance || !model || readOnly || !executeRef.current) {
      if (statementExecuteDecorationKeyRef.current) {
        statementExecuteDecorationIdsRef.current = editor.deltaDecorations(
          statementExecuteDecorationIdsRef.current,
          []
        )
        statementExecuteDecorationKeyRef.current = ''
      }
      return
    }

    const nextDecorationKey = statements
      .map((statement) => `${statement.startLineNumber}:${statement.startColumn}`)
      .join('|')
    if (nextDecorationKey === statementExecuteDecorationKeyRef.current) {
      return
    }

    statementExecuteDecorationIdsRef.current = editor.deltaDecorations(
      statementExecuteDecorationIdsRef.current,
      statements.map((statement) => {
        const range = new monacoInstance.Range(
          statement.startLineNumber,
          1,
          statement.startLineNumber,
          1
        )
        return {
          range,
          options: {
            linesDecorationsClassName: 'sql-editor-statement-execute',
            linesDecorationsTooltip: '执行此语句',
            stickiness: monacoInstance.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
          }
        }
      })
    )
    statementExecuteDecorationKeyRef.current = nextDecorationKey
  }

  const updateCallKeywordDecorations = (editor: Monaco.editor.IStandaloneCodeEditor): void => {
    const monacoInstance = monacoRef.current
    const model = editor.getModel()
    if (!monacoInstance || !model) {
      return
    }

    const decorations: Monaco.editor.IModelDeltaDecoration[] = []
    for (let lineNumber = 1; lineNumber <= model.getLineCount(); lineNumber += 1) {
      const line = model.getLineContent(lineNumber)
      for (const match of line.matchAll(/\bCALL\b/gi)) {
        const startColumn = (match.index ?? 0) + 1
        decorations.push({
          range: new monacoInstance.Range(lineNumber, startColumn, lineNumber, startColumn + 4),
          options: { inlineClassName: 'sql-editor-call-keyword' }
        })
      }
    }
    callKeywordDecorationIdsRef.current = editor.deltaDecorations(
      callKeywordDecorationIdsRef.current,
      decorations
    )
  }

  const syncEditorState = (editor: Monaco.editor.IStandaloneCodeEditor): void => {
    const model = editor.getModel()
    const statements = getCachedStatements(model)
    const currentStatement = getCurrentStatementInfo(editor, statements)
    activeStatementKeyRef.current = getStatementIdentity(currentStatement)
    lastSelectionDispatchKeyRef.current = `${activeStatementKeyRef.current}:${statements.length}`
    updateStatementDecorations(editor, currentStatement)
    updateStatementExecuteDecorations(editor, statements)
    updateCallKeywordDecorations(editor)
    selectionChangeRef.current?.(buildSelectionPayload(editor, statements, currentStatement, false))
  }

  const syncEditorSelectionState = (editor: Monaco.editor.IStandaloneCodeEditor): void => {
    const model = editor.getModel()
    const statements = getCachedStatements(model)
    const currentStatement = getCurrentStatementInfo(editor, statements)
    const nextStatementKey = getStatementIdentity(currentStatement)
    if (nextStatementKey === activeStatementKeyRef.current) {
      return
    }
    activeStatementKeyRef.current = nextStatementKey
    updateStatementDecorations(editor, currentStatement)
    const dispatchKey = `${nextStatementKey}:${statements.length}`
    if (dispatchKey === lastSelectionDispatchKeyRef.current) {
      return
    }
    lastSelectionDispatchKeyRef.current = dispatchKey
    selectionChangeRef.current?.(buildSelectionPayload(editor, statements, currentStatement, false))
  }

  const scheduleEditorSelectionSync = (editor: Monaco.editor.IStandaloneCodeEditor): void => {
    const model = editor.getModel()
    if (editorContentSyncTimeoutRef.current != null) {
      return
    }
    if (model && cachedStatementsRef.current.versionId === model.getVersionId()) {
      syncEditorSelectionState(editor)
      return
    }
    editorSelectionSyncFrameRef.current = window.requestAnimationFrame(() => {
      editorSelectionSyncFrameRef.current = undefined
      syncEditorSelectionState(editor)
    })
  }

  function scheduleEditorContentSync(editor: Monaco.editor.IStandaloneCodeEditor): void {
    if (editorContentSyncTimeoutRef.current) {
      window.clearTimeout(editorContentSyncTimeoutRef.current)
    }
    editorContentSyncTimeoutRef.current = window.setTimeout(() => {
      editorContentSyncTimeoutRef.current = undefined
      syncEditorState(editor)
    }, CONTENT_SYNC_DEBOUNCE_MS)
  }

  const scheduleRoutineCallCompletion = (editor: Monaco.editor.IStandaloneCodeEditor): void => {
    if (readOnly) {
      return
    }
    if (routineCompletionTimeoutRef.current) {
      window.clearTimeout(routineCompletionTimeoutRef.current)
    }
    routineCompletionTimeoutRef.current = window.setTimeout(() => {
      routineCompletionTimeoutRef.current = undefined
      const model = editor.getModel()
      const position = editor.getPosition()
      if (!model || !position || !isRoutineCallContext(getTextBeforePosition(model, position))) {
        return
      }
      const refreshSuggestions = (): void => {
        const currentModel = editor.getModel()
        const currentPosition = editor.getPosition()
        if (
          !currentModel ||
          !currentPosition ||
          !isRoutineCallContext(getTextBeforePosition(currentModel, currentPosition))
        ) {
          return
        }
        editor.trigger('datadjinn-routine-completion', 'editor.action.cancelSuggestWidget', {})
        editor.trigger('datadjinn-routine-completion', 'editor.action.triggerSuggest', {})
      }
      const loadRoutines = contextRef.current?.loadRoutines
      if (!loadRoutines) {
        refreshSuggestions()
        return
      }
      void loadRoutines().finally(refreshSuggestions)
    }, 80)
  }

  const scheduleEditorLayout = (editor: Monaco.editor.IStandaloneCodeEditor): void => {
    if (editorLayoutFrameRef.current) {
      window.cancelAnimationFrame(editorLayoutFrameRef.current)
    }
    editorLayoutFrameRef.current = window.requestAnimationFrame(() => {
      editorLayoutFrameRef.current = window.requestAnimationFrame(() => {
        editorLayoutFrameRef.current = undefined
        editor.layout()
      })
    })
  }

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    // Lazy-loaded editor panels can be measured before their parent splitter has settled.
    scheduleEditorLayout(editor)
    if (!readOnly) {
      registerCompletionProvider(monaco)
    }
    const isStatementExecuteTarget = (element: Element | null): boolean =>
      Boolean(element?.closest('.sql-editor-statement-execute'))

    const formatSelectionOrStatement = (statement?: SqlStatementInfo): void => {
      const model = editor.getModel()
      const selection = editor.getSelection()
      if (!model) {
        return
      }
      const range = selection && !selection.isEmpty()
        ? selection
        : statement
          ? new monaco.Range(
              statement.startLineNumber,
              statement.startColumn,
              statement.endLineNumber,
              statement.endColumn
            )
          : undefined
      if (!range) {
        return
      }
      const original = model.getValueInRange(range)
      const formatted = formatSql(original, contextRef.current?.dialect)
      if (!formatted || formatted === original) {
        return
      }
      editor.executeEdits('format-sql-statement', [{ range, text: formatted, forceMoveMarkers: true }])
      statementExecuteDecorationKeyRef.current = ''
      syncEditorState(editor)
    }

    readyRef.current?.({
      getSelectionPayload: () => {
        const model = editor.getModel()
        const statements = getCachedStatements(model)
        const currentStatement = getCurrentStatementInfo(editor, statements)
        return buildSelectionPayload(editor, statements, currentStatement, true)
      },
      getValue: () => editor.getValue(),
      formatSelectionOrStatement: () => {
        const statements = getCachedStatements(editor.getModel())
        formatSelectionOrStatement(getCurrentStatementInfo(editor, statements) ?? undefined)
      }
    })

    editor.onDidChangeCursorSelection(() => scheduleEditorSelectionSync(editor))

    editor.onDidChangeModelContent(() => {
      scheduleEditorContentSync(editor)
      scheduleRoutineCallCompletion(editor)
      scheduleEditorLayout(editor)
    })

    editor.onMouseDown((event) => {
      if (
        readOnly ||
        event.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS ||
        !isStatementExecuteTarget(event.target.element) ||
        !event.target.position
      ) {
        return
      }

      const statements = getCachedStatements(editor.getModel())
      const statement = statements.find(
        (item) => item.startLineNumber === event.target.position?.lineNumber
      )
      if (!statement) {
        return
      }

      event.event.preventDefault()
      event.event.stopPropagation()
      const payload = buildSelectionPayload(editor, statements, statement, false)
      executeRef.current?.({ ...payload, sql: statement.text })
    })

    editor.onMouseUp((event) => {
      if (isStatementExecuteTarget(event.target.element)) {
        event.event.preventDefault()
        event.event.stopPropagation()
      }
    })

    const editorNode = editor.getDomNode()
    const stopStatementExecuteClick = (event: MouseEvent): void => {
      if (!isStatementExecuteTarget(event.target instanceof Element ? event.target : null)) {
        return
      }
      event.stopImmediatePropagation()
      event.stopPropagation()
    }
    if (editorNode) {
      editorNode.addEventListener('click', stopStatementExecuteClick)
      editor.onDidDispose(() => editorNode.removeEventListener('click', stopStatementExecuteClick))
    }

    if (!readOnly) {
      const executeKeybinding =
        parseKeybinding(shortcuts?.execute) ?? monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter
      const deleteLineKeybinding =
        parseKeybinding(shortcuts?.deleteLine) ?? monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD
      const duplicateLineDownKeybinding =
        parseKeybinding(shortcuts?.duplicateLineDown) ??
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.DownArrow
      editor.addAction({
        id: 'execute-query',
        label: 'Execute Query',
        keybindings: [executeKeybinding],
        run: () => {
          const payload = buildSelectionPayload(editor)
          executeRef.current?.({
            ...payload,
            sql: payload.selectedSql || payload.currentStatementSql || undefined
          })
        }
      })
      editor.addAction({
        id: 'delete-line',
        label: 'Delete Line',
        keybindings: [deleteLineKeybinding],
        run: () => editor.trigger('keyboard', 'editor.action.deleteLines', null)
      })
      editor.addAction({
        id: 'duplicate-line-down',
        label: 'Duplicate Line Down',
        keybindings: [duplicateLineDownKeybinding],
        run: () => editor.trigger('keyboard', 'editor.action.copyLinesDownAction', null)
      })
    }

    syncEditorState(editor)
  }

  return (
    <Editor
      height={height}
      language="sql"
      theme={theme === 'dark' ? 'datadjinn-dark' : 'datadjinn-light'}
      value={value}
      onChange={(nextValue) => {
        const normalizedValue = nextValue ?? ''
        latestValueRef.current = normalizedValue
        if (!onChange) {
          return
        }
        onChange(normalizedValue)
      }}
      onMount={handleMount}
      options={{
        fixedOverflowWidgets: false,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on',
        cursorBlinking: 'blink',
        cursorSmoothCaretAnimation: 'off',
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        renderLineHighlight: 'none',
        selectionHighlight: false,
        occurrencesHighlight: 'off',
        folding: false,
        bracketPairColorization: { enabled: true },
        guides: { highlightActiveBracketPair: false },
        stickyScroll: { enabled: false },
        automaticLayout: true,
        padding: { top: 6 },
        lineNumbersMinChars: 2,
        lineDecorationsWidth: 18,
        suggest: {
          showKeywords: !readOnly,
          showSnippets: false,
          showFields: !readOnly,
          showStructs: !readOnly,
          showWords: false,
          preview: false
        },
        inlineSuggest: { enabled: false },
        tabCompletion: 'off',
        quickSuggestions: readOnly ? false : { other: true, comments: false, strings: false },
        tabSize: 2,
        renderWhitespace: 'none',
        glyphMargin: false,
        readOnly,
        domReadOnly: readOnly
      }}
    />
  )
}

export default SqlEditor
