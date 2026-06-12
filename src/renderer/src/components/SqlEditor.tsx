import Editor, { loader, OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import * as monaco from 'monaco-editor'
import { useEffect, useRef } from 'react'

loader.config({ monaco })

export type SqlDialect = 'sqlite' | 'mysql' | 'postgresql' | 'dm' | 'gaussdb' | 'oracle' | 'mongodb' | 'redis' | 'clickhouse'

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
}

interface SqlEditorProps {
  value: string
  onChange: (value: string) => void
  onExecute?: (payload: { sql?: string; selectedSql: string; currentStatementSql: string }) => void
  onSelectionChange?: (payload: { selectedSql: string; currentStatementSql: string }) => void
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
  'ROLLBACK'
]

const DIALECT_KEYWORDS: Record<SqlDialect, string[]> = {
  sqlite: ['AUTOINCREMENT', 'WITHOUT ROWID', 'PRAGMA', 'RETURNING'],
  mysql: ['AUTO_INCREMENT', 'ENGINE', 'UNSIGNED', 'SHOW DATABASES', 'SHOW TABLES', 'DESCRIBE'],
  postgresql: ['SERIAL', 'BIGSERIAL', 'RETURNING', 'ILIKE', 'ON CONFLICT', 'JSONB', 'UUID'],
  dm: ['ROWNUM', 'CONNECT BY', 'START WITH', 'SYSDATE', 'SYSTIMESTAMP', 'NVL', 'DECODE', 'DUAL'],
  gaussdb: ['SERIAL', 'BIGSERIAL', 'RETURNING', 'ILIKE', 'ON CONFLICT', 'JSONB', 'UUID', 'DISTRIBUTE BY', 'PARTITION BY'],
  oracle: ['ROWNUM', 'CONNECT BY', 'START WITH', 'SYSDATE', 'SYSTIMESTAMP', 'NVL', 'DECODE', 'DUAL', 'MERGE', 'SEQUENCE'],
  mongodb: ['db', 'find', 'aggregate', 'countDocuments', 'distinct', 'sort', 'limit', 'skip', 'ObjectId'],
  redis: ['SCAN', 'KEYS', 'GET', 'SET', 'HGETALL', 'HSET', 'LRANGE', 'LPUSH', 'RPUSH', 'SMEMBERS', 'SADD', 'ZRANGE', 'ZADD', 'DEL', 'EXPIRE', 'TTL', 'TYPE'],
  clickhouse: ['MergeTree', 'ReplacingMergeTree', 'ORDER BY', 'PARTITION BY', 'UInt8', 'UInt32', 'UInt64', 'Int64', 'String', 'DateTime', 'Nullable', 'SHOW CREATE TABLE', 'DESCRIBE TABLE']
}

const SQL_SNIPPETS = [
  { label: 'select-limit', insertText: 'SELECT * FROM ${1:table} LIMIT ${2:100};', detail: 'SELECT * FROM table LIMIT 100' },
  { label: 'insert-values', insertText: 'INSERT INTO ${1:table} (${2:columns}) VALUES (${3:values});', detail: 'INSERT INTO table (...) VALUES (...)' },
  { label: 'update-where', insertText: 'UPDATE ${1:table} SET ${2:column} = ${3:value} WHERE ${4:condition};', detail: 'UPDATE table SET ... WHERE ...' },
  { label: 'delete-where', insertText: 'DELETE FROM ${1:table} WHERE ${2:condition};', detail: 'DELETE FROM table WHERE ...' },
  { label: 'create-table', insertText: 'CREATE TABLE ${1:table} (\n  ${2:id} INTEGER PRIMARY KEY\n);', detail: 'CREATE TABLE table (...)' }
]

const TABLE_CONTEXT_KEYWORDS = ['FROM', 'JOIN', 'UPDATE', 'INTO']
const COLUMN_CONTEXT_KEYWORDS = ['SELECT', 'WHERE', 'ON', 'ORDER BY', 'GROUP BY', 'HAVING', 'SET']

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

  if (dialect === 'postgresql' || dialect === 'dm' || dialect === 'gaussdb' || dialect === 'oracle') {
    return `"${name.replaceAll('"', '""')}"`
  }

  return `\`${name.replaceAll('`', '``')}\``
}

const getTextBeforePosition = (model: Monaco.editor.ITextModel, position: Monaco.Position): string => {
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

const getDotQualifier = (text: string): string | undefined => {
  const match = text.match(/([A-Za-z_][\w$]*|`[^`]+`|"[^"]+")\.$/)
  return match?.[1]?.replace(/^`|`$/g, '').replace(/^"|"$/g, '')
}

const splitSqlStatements = (sql: string): { text: string; start: number; end: number }[] => {
  const statements: { text: string; start: number; end: number }[] = []
  let quote: "'" | '"' | '`' | null = null
  let lineComment = false
  let blockComment = false
  let start = 0

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]
    const next = sql[index + 1]

    if (lineComment) {
      if (char === '\n') {
        lineComment = false
      }
      continue
    }

    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false
        index += 1
      }
      continue
    }

    if (quote) {
      if (char === quote) {
        if ((quote === "'" || quote === '"') && next === quote) {
          index += 1
          continue
        }
        quote = null
      }
      continue
    }

    if (char === '-' && next === '-') {
      lineComment = true
      index += 1
      continue
    }

    if (char === '/' && next === '*') {
      blockComment = true
      index += 1
      continue
    }

    if (char === "'" || char === '"' || char === '`') {
      quote = char
      continue
    }

    if (char === ';') {
      const raw = sql.slice(start, index)
      const trimmed = raw.trim()
      if (trimmed) {
        const trimmedStartOffset = raw.search(/\S/)
        const trimmedEndOffset = raw.length - raw.trimEnd().length
        const statementStart = start + Math.max(0, trimmedStartOffset)
        const statementEnd = index - trimmedEndOffset
        statements.push({ text: trimmed, start: statementStart, end: statementEnd })
      }
      start = index + 1
    }
  }

  const tail = sql.slice(start)
  const trimmedTail = tail.trim()
  if (trimmedTail) {
    const trimmedStartOffset = tail.search(/\S/)
    const trimmedEndOffset = tail.length - tail.trimEnd().length
    const statementStart = start + Math.max(0, trimmedStartOffset)
    const statementEnd = sql.length - trimmedEndOffset
    statements.push({ text: trimmedTail, start: statementStart, end: statementEnd })
  }

  return statements
}

const normalizeShortcut = (shortcut?: string): string => shortcut?.replace(/\s+/g, '').toLowerCase() ?? ''

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

  return keyCode == null ? null : (binding | keyCode)
}

function SqlEditor({ value, onChange, onExecute, onSelectionChange, theme, completionContext, readOnly = false, height = '100%', shortcuts }: SqlEditorProps): React.JSX.Element {
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const monacoRef = useRef<typeof Monaco | null>(null)
  const completionDisposableRef = useRef<Monaco.IDisposable | null>(null)
  const contextRef = useRef<SqlCompletionContext | undefined>(completionContext)
  const executeRef = useRef<((payload: { sql?: string; selectedSql: string; currentStatementSql: string }) => void) | undefined>(onExecute)
  const selectionChangeRef = useRef<((payload: { selectedSql: string; currentStatementSql: string }) => void) | undefined>(onSelectionChange)

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
    return () => {
      completionDisposableRef.current?.dispose()
      completionDisposableRef.current = null
    }
  }, [])

  const registerCompletionProvider = (monaco: typeof Monaco): void => {
    completionDisposableRef.current?.dispose()
    completionDisposableRef.current = monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: [' ', '.', ',', '('],
      provideCompletionItems: (model, position) => {
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
        const qualifier = getDotQualifier(textBefore)
        const suggestions: Monaco.languages.CompletionItem[] = []
        const keywordSort = mode === 'all' ? '1' : '4'
        const tableSort = mode === 'table' ? '0' : '2'
        const columnSort = mode === 'column' || qualifier ? '0' : '3'

        for (const keyword of uniqueBy([...COMMON_KEYWORDS, ...DIALECT_KEYWORDS[context.dialect ?? 'sqlite']], (item) => item)) {
          suggestions.push({ label: keyword, kind: monaco.languages.CompletionItemKind.Keyword, insertText: keyword, sortText: `${keywordSort}_${keyword}`, range })
        }

        for (const snippet of SQL_SNIPPETS) {
          suggestions.push({
            label: snippet.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: snippet.insertText,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: snippet.detail,
            sortText: `1_${snippet.label}`,
            range
          })
        }

        for (const database of uniqueBy(context.databases ?? [], (item) => item)) {
          suggestions.push({ label: database, kind: monaco.languages.CompletionItemKind.Module, insertText: quoteIdentifier(database, context.dialect), detail: '数据库', sortText: `5_${database}`, range })
        }

        for (const schema of uniqueBy(context.schemas ?? [], (item) => item)) {
          suggestions.push({ label: schema, kind: monaco.languages.CompletionItemKind.Module, insertText: quoteIdentifier(schema, context.dialect), detail: 'Schema', sortText: `5_${schema}`, range })
        }

        const tables = uniqueBy(context.tables ?? [], (table) => `${table.databaseName ?? ''}.${table.schemaName ?? ''}.${table.name}`)
        const qualifiedTables = qualifier ? tables.filter((table) => table.schemaName === qualifier || table.databaseName === qualifier) : tables
        for (const table of qualifiedTables) {
          suggestions.push({ label: table.name, kind: monaco.languages.CompletionItemKind.Struct, insertText: quoteIdentifier(table.name, context.dialect), detail: [table.schemaName, table.databaseName].filter(Boolean).join('.') || '表', sortText: `${tableSort}_${table.name}`, range })
        }

        const tableColumns = tables.flatMap((table) => table.columns ?? [])
        const columns = uniqueBy([...(context.columns ?? []), ...tableColumns], (column) => `${column.databaseName ?? ''}.${column.schemaName ?? ''}.${column.tableName ?? ''}.${column.name}`)
        const qualifiedColumns = qualifier ? columns.filter((column) => column.tableName === qualifier || column.schemaName === qualifier) : columns
        for (const column of qualifiedColumns) {
          suggestions.push({ label: column.name, kind: monaco.languages.CompletionItemKind.Field, insertText: quoteIdentifier(column.name, context.dialect), detail: [column.tableName, column.type].filter(Boolean).join(' · ') || '字段', sortText: `${columnSort}_${column.name}`, range })
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

  const getCurrentStatementSql = (editor: Monaco.editor.IStandaloneCodeEditor): string => {
    const model = editor.getModel()
    const position = editor.getPosition()
    if (!model || !position) {
      return ''
    }

    const fullSql = model.getValue()
    const statements = splitSqlStatements(fullSql)
    if (statements.length <= 1) {
      return model.getLineContent(position.lineNumber).trim() || fullSql.trim()
    }

    const offset = model.getOffsetAt(position)
    for (const statement of statements) {
      if (offset >= statement.start && offset <= statement.end) {
        return statement.text
      }
    }

    return model.getLineContent(position.lineNumber).trim() || fullSql.trim()
  }

  const emitSelectionState = (editor: Monaco.editor.IStandaloneCodeEditor): void => {
    selectionChangeRef.current?.({
      selectedSql: getSelectedSql(editor),
      currentStatementSql: getCurrentStatementSql(editor)
    })
  }

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco
    if (!readOnly) {
      registerCompletionProvider(monaco)
    }

    editor.onDidChangeCursorSelection(() => {
      emitSelectionState(editor)
    })

    if (!readOnly) {
      const executeKeybinding = parseKeybinding(shortcuts?.execute) ?? (monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter)
      const deleteLineKeybinding = parseKeybinding(shortcuts?.deleteLine) ?? (monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD)
      const duplicateLineDownKeybinding = parseKeybinding(shortcuts?.duplicateLineDown) ?? (monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.DownArrow)
      editor.addAction({
        id: 'execute-query',
        label: 'Execute Query',
        keybindings: [executeKeybinding],
        run: () => {
          const selectedSql = getSelectedSql(editor)
          const currentStatementSql = getCurrentStatementSql(editor)
          executeRef.current?.({
            sql: selectedSql || currentStatementSql || undefined,
            selectedSql,
            currentStatementSql
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

    emitSelectionState(editor)
  }

  return (
    <Editor
      height={height}
      language="sql"
      theme={theme === 'dark' ? 'vs-dark' : 'vs'}
      value={value}
      onChange={(v) => onChange(v ?? '')}
      onMount={handleMount}
      options={{
        fixedOverflowWidgets: true,
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on',
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        renderLineHighlight: 'line',
        folding: true,
        bracketPairColorization: { enabled: true },
        automaticLayout: true,
        padding: { top: 6 },
        suggest: { showKeywords: !readOnly, showSnippets: !readOnly, showFields: !readOnly, showStructs: !readOnly, preview: !readOnly },
        tabCompletion: readOnly ? 'off' : 'on',
        quickSuggestions: readOnly ? false : { other: true, comments: false, strings: false },
        tabSize: 2,
        renderWhitespace: 'boundary',
        glyphMargin: false,
        readOnly,
        domReadOnly: readOnly
      }}
    />
  )
}

export default SqlEditor
