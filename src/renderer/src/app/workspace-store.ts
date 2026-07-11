import { create } from 'zustand'
import type { WorkspaceTab } from './workspace-model'

export type WorkspaceTabSummary = {
  key: string
  title: string
}

type WorkspaceState = {
  tabs: WorkspaceTab[]
  tabSummaries: WorkspaceTabSummary[]
  activeTabKey?: string
  getTabByKey: (key?: string) => WorkspaceTab | undefined
  getRecentQuerySql: () => string[]
  setTabs: (tabs: WorkspaceTab[] | ((current: WorkspaceTab[]) => WorkspaceTab[])) => void
  setActiveTabKey: (key?: string | ((current?: string) => string | undefined)) => void
  setTabsAndActiveTabKey: (
    tabs: WorkspaceTab[] | ((current: WorkspaceTab[]) => WorkspaceTab[]),
    activeTabKey?: string | ((current?: string) => string | undefined)
  ) => void
  resetWorkspace: () => void
}

const resolveUpdater = <T>(value: T | ((current: T) => T), current: T): T =>
  typeof value === 'function' ? (value as (current: T) => T)(current) : value

const buildTabSummaries = (
  tabs: WorkspaceTab[],
  current: WorkspaceTabSummary[]
): WorkspaceTabSummary[] => {
  const next = tabs.map((tab) => ({ key: tab.key, title: tab.title }))
  if (
    next.length === current.length &&
    next.every(
      (item, index) => item.key === current[index]?.key && item.title === current[index]?.title
    )
  ) {
    return current
  }
  return next
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  tabs: [],
  tabSummaries: [],
  activeTabKey: undefined,
  getTabByKey: (key) => {
    if (!key) {
      return undefined
    }
    return useWorkspaceStore.getState().tabs.find((tab) => tab.key === key)
  },
  getRecentQuerySql: () =>
    useWorkspaceStore
      .getState()
      .tabs.filter((tab) => tab.kind === 'query' && tab.sql.trim())
      .slice(-5)
      .map((tab) => tab.sql),
  setTabs: (tabs) =>
    set((state) => {
      const nextTabs = resolveUpdater(tabs, state.tabs)
      return {
        tabs: nextTabs,
        tabSummaries: buildTabSummaries(nextTabs, state.tabSummaries)
      }
    }),
  setActiveTabKey: (key) =>
    set((state) => ({ activeTabKey: resolveUpdater(key, state.activeTabKey) })),
  setTabsAndActiveTabKey: (tabs, activeTabKey) =>
    set((state) => {
      const nextTabs = resolveUpdater(tabs, state.tabs)
      const nextActiveTabKey =
        activeTabKey === undefined
          ? state.activeTabKey
          : resolveUpdater(activeTabKey, state.activeTabKey)
      return {
        tabs: nextTabs,
        tabSummaries: buildTabSummaries(nextTabs, state.tabSummaries),
        activeTabKey: nextActiveTabKey
      }
    }),
  resetWorkspace: () => set({ tabs: [], tabSummaries: [], activeTabKey: undefined })
}))
