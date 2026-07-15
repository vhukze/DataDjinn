import type { AIContextSource } from './workspace-model'

export const AI_CONTEXT_COLLAPSED_LIMIT = 3

export type AIContextSourceRole = 'primary' | 'temporary-primary' | 'supplementary'

export const buildAIContextSourceId = (
  source: Pick<AIContextSource, 'type' | 'connectionId' | 'database' | 'schema' | 'pgDatabase'>
): string =>
  [
    source.type,
    source.connectionId,
    source.pgDatabase ?? '',
    source.database ?? '',
    source.schema ?? ''
  ].join(':')

export const isSameSchemaDatabaseScope = (
  left: AIContextSource,
  right: AIContextSource
): boolean =>
  Boolean(
    left.pgDatabase &&
      right.pgDatabase &&
      left.connectionId === right.connectionId &&
      left.pgDatabase === right.pgDatabase
  )

export const shouldSwitchAIPrimaryContext = (
  activeSource: AIContextSource | undefined,
  targetSource: AIContextSource
): boolean =>
  Boolean(
    activeSource &&
      activeSource.id !== targetSource.id &&
      isSameSchemaDatabaseScope(activeSource, targetSource)
  )

export const pruneManualAIContextsForPrimary = (
  manualSources: AIContextSource[],
  primarySource: AIContextSource
): AIContextSource[] =>
  manualSources.filter((source) => {
    if (!isSameSchemaDatabaseScope(source, primarySource)) {
      return true
    }
    if (primarySource.type === 'database') {
      return false
    }
    return source.type === 'schema' && source.id !== primarySource.id
  })

export const mergeAIContextSources = (
  primarySource: AIContextSource | undefined,
  manualSources: AIContextSource[]
): AIContextSource[] => {
  const merged = primarySource ? [primarySource] : []

  for (const source of manualSources) {
    if (merged.some((item) => item.id === source.id)) {
      continue
    }

    if (
      primarySource &&
      isSameSchemaDatabaseScope(primarySource, source) &&
      (primarySource.type === 'database' || source.type === 'database')
    ) {
      continue
    }

    const parentDatabaseExists = merged.some(
      (item) => item.type === 'database' && isSameSchemaDatabaseScope(item, source)
    )
    if (source.type === 'schema' && parentDatabaseExists) {
      continue
    }

    if (source.type === 'database' && source.pgDatabase) {
      for (let index = merged.length - 1; index >= 0; index -= 1) {
        const item = merged[index]
        if (item.type === 'schema' && isSameSchemaDatabaseScope(item, source)) {
          merged.splice(index, 1)
        }
      }
    }

    merged.push(source)
  }

  return merged
}

export const resolveAIExecutionContextSource = (
  primarySource: AIContextSource | undefined,
  effectiveSources: AIContextSource[]
): AIContextSource | undefined => primarySource ?? effectiveSources[0]

export const resolveAIContextSourceRole = (
  sourceId: string,
  primarySourceId: string | undefined,
  executionSourceId: string | undefined
): AIContextSourceRole => {
  if (sourceId === primarySourceId) {
    return 'primary'
  }
  if (sourceId === executionSourceId) {
    return 'temporary-primary'
  }
  return 'supplementary'
}

export const getVisibleAIContextSources = (
  sources: AIContextSource[],
  expanded: boolean
): AIContextSource[] =>
  expanded ? sources : sources.slice(0, AI_CONTEXT_COLLAPSED_LIMIT)

export const resolveAIContextDatabaseSelection = (
  source: AIContextSource | undefined,
  schemaScoped: boolean
): { database?: string; pgDatabase?: string; dbName?: string } => {
  if (!source) {
    return {}
  }
  if (!schemaScoped) {
    return { database: source.database, dbName: source.database }
  }

  const database = source.schema
  const pgDatabase = source.pgDatabase ?? source.database
  return {
    database,
    pgDatabase,
    dbName: [pgDatabase, database].filter(Boolean).join('.')
  }
}
