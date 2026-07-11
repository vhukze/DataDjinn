import { create } from 'zustand'
import type { Key } from 'react'
import type { DatabaseTreeNode } from './tree-model'

type TreeContextMenuState = {
  x: number
  y: number
  node: DatabaseTreeNode
} | null

type ResourceTreeState = {
  expandedKeys: Key[]
  selectedTreeKeys: Key[]
  selectedConnectionIds: string[]
  connectionSelectionAnchorId?: string
  treeSearchOpen: boolean
  treeSearchText: string
  treeContextMenu: TreeContextMenuState
  setExpandedKeys: (keys: Key[] | ((current: Key[]) => Key[])) => void
  setSelectedTreeKeys: (keys: Key[] | ((current: Key[]) => Key[])) => void
  setSelectedConnectionIds: (ids: string[] | ((current: string[]) => string[])) => void
  setConnectionSelectionAnchorId: (id?: string) => void
  setTreeSearchOpen: (open: boolean | ((current: boolean) => boolean)) => void
  setTreeSearchText: (text: string | ((current: string) => string)) => void
  setTreeContextMenu: (value: TreeContextMenuState) => void
  resetTreeUiState: () => void
}

const resolveUpdater = <T>(value: T | ((current: T) => T), current: T): T =>
  typeof value === 'function' ? (value as (current: T) => T)(current) : value

export const useResourceTreeStore = create<ResourceTreeState>((set) => ({
  expandedKeys: [],
  selectedTreeKeys: [],
  selectedConnectionIds: [],
  connectionSelectionAnchorId: undefined,
  treeSearchOpen: false,
  treeSearchText: '',
  treeContextMenu: null,
  setExpandedKeys: (keys) =>
    set((state) => ({ expandedKeys: resolveUpdater(keys, state.expandedKeys) })),
  setSelectedTreeKeys: (keys) =>
    set((state) => ({ selectedTreeKeys: resolveUpdater(keys, state.selectedTreeKeys) })),
  setSelectedConnectionIds: (ids) =>
    set((state) => ({ selectedConnectionIds: resolveUpdater(ids, state.selectedConnectionIds) })),
  setConnectionSelectionAnchorId: (id) => set({ connectionSelectionAnchorId: id }),
  setTreeSearchOpen: (open) =>
    set((state) => ({ treeSearchOpen: resolveUpdater(open, state.treeSearchOpen) })),
  setTreeSearchText: (text) =>
    set((state) => ({ treeSearchText: resolveUpdater(text, state.treeSearchText) })),
  setTreeContextMenu: (value) => set({ treeContextMenu: value }),
  resetTreeUiState: () =>
    set({
      expandedKeys: [],
      selectedTreeKeys: [],
      selectedConnectionIds: [],
      connectionSelectionAnchorId: undefined,
      treeSearchOpen: false,
      treeSearchText: '',
      treeContextMenu: null
    })
}))

export type { TreeContextMenuState }
