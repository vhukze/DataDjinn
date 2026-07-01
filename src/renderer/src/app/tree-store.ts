import { create } from 'zustand'
import type { Key } from 'react'

type TreeState = {
  expandedKeys: Key[]
  setExpandedKeys: (keys: Key[] | ((current: Key[]) => Key[])) => void
}

const resolveUpdater = <T,>(value: T | ((current: T) => T), current: T): T => (
  typeof value === 'function'
    ? (value as (current: T) => T)(current)
    : value
)

export const useTreeStore = create<TreeState>((set) => ({
  expandedKeys: [],
  setExpandedKeys: (keys) => set((state) => ({
    expandedKeys: resolveUpdater(keys, state.expandedKeys)
  }))
}))
