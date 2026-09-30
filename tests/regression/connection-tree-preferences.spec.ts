import { expect, test } from '@playwright/test'
import {
  hasPersistedConnectionTreePreferences,
  selectConnectionTreePreferences
} from '../../src/renderer/src/app/persistence'

test('connection tree preferences should fall back to Electron storage when backend read fails @bug', () => {
  const stored = {
    selected_databases: { 'connection-1': ['orders'] },
    selected_schemas: {}
  }
  const selection = selectConnectionTreePreferences(
    { preferences: stored, updatedAt: Date.now() },
    undefined,
    { selected_databases: { 'connection-1': ['default', 'orders'] } }
  )

  expect(selection.source).toBe('stored')
  expect(selection.preferences).toEqual(stored)
})

test('connection tree preferences should choose the newer durable copy @bug', () => {
  const stored = { selected_databases: { 'connection-1': ['default'] } }
  const server = { selected_databases: { 'connection-1': ['orders'] } }

  expect(
    selectConnectionTreePreferences(
      { preferences: stored, updatedAt: 100 },
      { preferences: server, updatedAt: 200 },
      {}
    )
  ).toEqual({ preferences: server, source: 'server' })

  expect(
    selectConnectionTreePreferences(
      { preferences: stored, updatedAt: 300 },
      { preferences: server, updatedAt: 200 },
      {}
    )
  ).toEqual({ preferences: stored, source: 'stored' })
})

test('connection tree preferences should preserve legacy renderer cache when no durable copy exists @bug', () => {
  const local = { selected_databases: { 'connection-1': ['orders'] } }

  expect(selectConnectionTreePreferences(undefined, undefined, local)).toEqual({
    preferences: local,
    source: 'local'
  })
})

test('an empty durable connection tree snapshot should override stale legacy cache @bug', () => {
  const emptySnapshot = {
    connection_folders: [],
    connection_folder_assignments: {},
    selected_databases: {},
    selected_schemas: {}
  }

  expect(
    hasPersistedConnectionTreePreferences({
      preferences: emptySnapshot,
      updatedAt: 100,
      exists: true
    })
  ).toBe(true)
  expect(
    selectConnectionTreePreferences(
      { preferences: emptySnapshot, updatedAt: 100 },
      undefined,
      {
        connection_folders: [{ id: 'stale-folder', name: '旧缓存' }],
        connection_folder_assignments: { 'connection-1': 'stale-folder' }
      }
    )
  ).toEqual({ preferences: emptySnapshot, source: 'stored' })
})
