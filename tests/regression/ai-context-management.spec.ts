import { expect, test } from '@playwright/test'

import {
  getVisibleAIContextSources,
  isSameSchemaDatabaseScope,
  mergeAIContextSources,
  pruneManualAIContextsForPrimary,
  resolveAIContextDatabaseSelection,
  resolveAIContextSourceRole,
  resolveAIExecutionContextSource,
  shouldSwitchAIPrimaryContext
} from '../../src/renderer/src/app/ai-context'
import type { AIContextSource } from '../../src/renderer/src/app/workspace-model'

const databaseContext: AIContextSource = {
  id: 'database:connection-a::analytics:',
  type: 'database',
  connectionId: 'connection-a',
  connectionName: '分析库',
  dbType: 'clickhouse',
  database: 'analytics'
}

const schemaContext: AIContextSource = {
  id: 'schema:connection-b:postgres:postgres:public',
  type: 'schema',
  connectionId: 'connection-b',
  connectionName: '业务库',
  dbType: 'postgresql',
  database: 'postgres',
  pgDatabase: 'postgres',
  schema: 'public'
}

test('manual AI context should become the temporary execution context without an active database @bug', () => {
  const merged = mergeAIContextSources(undefined, [databaseContext, schemaContext])

  expect(merged).toEqual([databaseContext, schemaContext])
  expect(resolveAIExecutionContextSource(undefined, merged)).toEqual(databaseContext)
})

test('active AI context should stay primary and deduplicate matching manual contexts @bug', () => {
  const manualContexts = [databaseContext, schemaContext]
  const merged = mergeAIContextSources(databaseContext, manualContexts)

  expect(merged).toEqual([databaseContext, schemaContext])
  expect(resolveAIExecutionContextSource(databaseContext, merged)).toEqual(databaseContext)
  expect(manualContexts).toEqual([databaseContext, schemaContext])
})

test('AI context roles and collapsed list should stay clear with many sources @bug', () => {
  const sources = [
    databaseContext,
    schemaContext,
    { ...databaseContext, id: 'database:connection-c::logs:', connectionId: 'connection-c' },
    { ...databaseContext, id: 'database:connection-d::audit:', connectionId: 'connection-d' }
  ]

  expect(getVisibleAIContextSources(sources, false)).toEqual(sources.slice(0, 3))
  expect(getVisibleAIContextSources(sources, true)).toEqual(sources)
  expect(resolveAIContextSourceRole(databaseContext.id, undefined, databaseContext.id)).toBe(
    'temporary-primary'
  )
  expect(resolveAIContextSourceRole(schemaContext.id, databaseContext.id, databaseContext.id)).toBe(
    'supplementary'
  )
})

test('AI execution parameters should map database and schema contexts correctly @bug', () => {
  expect(resolveAIContextDatabaseSelection(databaseContext, false)).toEqual({
    database: 'analytics',
    dbName: 'analytics'
  })
  expect(resolveAIContextDatabaseSelection(schemaContext, true)).toEqual({
    database: 'public',
    pgDatabase: 'postgres',
    dbName: 'postgres.public'
  })
})

test('schema-scoped AI contexts should merge parent databases and child schemas @bug', () => {
  const databaseSource: AIContextSource = {
    ...schemaContext,
    id: 'database:connection-b:postgres:postgres:',
    type: 'database',
    schema: undefined
  }
  const siblingSchema: AIContextSource = {
    ...schemaContext,
    id: 'schema:connection-b:postgres:postgres:sales',
    schema: 'sales'
  }

  expect(isSameSchemaDatabaseScope(databaseSource, schemaContext)).toBe(true)
  expect(isSameSchemaDatabaseScope(schemaContext, siblingSchema)).toBe(true)
  expect(shouldSwitchAIPrimaryContext(schemaContext, databaseSource)).toBe(true)
  expect(shouldSwitchAIPrimaryContext(databaseSource, schemaContext)).toBe(true)
  expect(mergeAIContextSources(databaseSource, [schemaContext, siblingSchema])).toEqual([
    databaseSource
  ])
  expect(mergeAIContextSources(schemaContext, [databaseSource, siblingSchema])).toEqual([
    schemaContext,
    siblingSchema
  ])
  expect(mergeAIContextSources(undefined, [schemaContext, siblingSchema, databaseSource])).toEqual([
    databaseSource
  ])
  expect(pruneManualAIContextsForPrimary([schemaContext, siblingSchema], databaseSource)).toEqual(
    []
  )
  expect(
    pruneManualAIContextsForPrimary([databaseSource, schemaContext, siblingSchema], schemaContext)
  ).toEqual([siblingSchema])
})
