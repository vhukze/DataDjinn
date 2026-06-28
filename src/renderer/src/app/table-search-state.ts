import type { TableSearchUiState, WorkspaceTab } from './workspace-model'

export const createDefaultTableSearchUiState = (): TableSearchUiState => ({
  visible: false,
  query: '',
  caseSensitive: false,
  regex: false,
  wholeWord: false,
  filterRows: false,
  activeMatchIndex: 0
})

export const getTableSearchUiState = (
  state: Record<string, TableSearchUiState>,
  tab: WorkspaceTab
): TableSearchUiState => state[tab.key] ?? createDefaultTableSearchUiState()

export const patchTableSearchUiState = (
  state: Record<string, TableSearchUiState>,
  tab: WorkspaceTab,
  patch: Partial<TableSearchUiState>
): Record<string, TableSearchUiState> => {
  const previousState = state[tab.key] ?? createDefaultTableSearchUiState()
  const nextState = {
    ...previousState,
    ...patch
  }

  if (
    previousState.visible === nextState.visible
    && previousState.query === nextState.query
    && previousState.caseSensitive === nextState.caseSensitive
    && previousState.regex === nextState.regex
    && previousState.wholeWord === nextState.wholeWord
    && previousState.filterRows === nextState.filterRows
    && previousState.activeMatchIndex === nextState.activeMatchIndex
  ) {
    return state
  }

  return {
    ...state,
    [tab.key]: nextState
  }
}
