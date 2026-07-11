import { startTransition } from 'react'
import type { DatabaseTreeNode } from './tree-model'

type HandleTreeSelectionOptions = {
  node: DatabaseTreeNode
  nativeEvent?: MouseEvent
  resourceTreeContainer: HTMLDivElement | null
  connectionSelectionAnchorId?: string
  selectedConnectionIds: string[]
  getVisibleConnectionIds: () => string[]
  setFocusedTreeNode: (node: DatabaseTreeNode) => void
  setSelectedConnectionId: (connectionId?: string) => void
  setSelectedConnectionIds: (connectionIds: string[]) => void
  setSelectedTreeKeys: (keys: React.Key[]) => void
  setConnectionSelectionAnchorId: (anchorId?: string) => void
}

export const selectConnectionTreeNodes = (
  connectionIds: string[],
  anchorId: string | undefined,
  setSelectedConnectionIds: (connectionIds: string[]) => void,
  setSelectedTreeKeys: (keys: React.Key[]) => void,
  setConnectionSelectionAnchorId: (anchorId?: string) => void
): void => {
  const nextConnectionIds = Array.from(new Set(connectionIds))
  setSelectedConnectionIds(nextConnectionIds)
  setSelectedTreeKeys(nextConnectionIds.map((connectionId) => `connection:${connectionId}`))
  setConnectionSelectionAnchorId(anchorId ?? nextConnectionIds.at(-1))
}

export const handleTreeSelectionChange = ({
  node,
  nativeEvent,
  resourceTreeContainer,
  connectionSelectionAnchorId,
  selectedConnectionIds,
  getVisibleConnectionIds,
  setFocusedTreeNode,
  setSelectedConnectionId,
  setSelectedConnectionIds,
  setSelectedTreeKeys,
  setConnectionSelectionAnchorId
}: HandleTreeSelectionOptions): void => {
  resourceTreeContainer?.focus()
  startTransition(() => {
    setFocusedTreeNode(node)
    if (node.connectionId) {
      setSelectedConnectionId(node.connectionId)
    }
  })

  if (node.kind !== 'connection' || !node.connectionId) {
    setSelectedConnectionIds([])
    setSelectedTreeKeys([node.key as React.Key])
    return
  }

  const event = nativeEvent
  if (event?.shiftKey && connectionSelectionAnchorId) {
    const visibleConnectionIds = getVisibleConnectionIds()
    const anchorIndex = visibleConnectionIds.indexOf(connectionSelectionAnchorId)
    const currentIndex = visibleConnectionIds.indexOf(node.connectionId)
    if (anchorIndex >= 0 && currentIndex >= 0) {
      const [startIndex, endIndex] =
        anchorIndex <= currentIndex ? [anchorIndex, currentIndex] : [currentIndex, anchorIndex]
      selectConnectionTreeNodes(
        visibleConnectionIds.slice(startIndex, endIndex + 1),
        connectionSelectionAnchorId,
        setSelectedConnectionIds,
        setSelectedTreeKeys,
        setConnectionSelectionAnchorId
      )
      return
    }
  }

  if (event?.ctrlKey || event?.metaKey) {
    const nextConnectionIds = selectedConnectionIds.includes(node.connectionId)
      ? selectedConnectionIds.filter((connectionId) => connectionId !== node.connectionId)
      : [...selectedConnectionIds, node.connectionId]
    selectConnectionTreeNodes(
      nextConnectionIds.length > 0 ? nextConnectionIds : [node.connectionId],
      node.connectionId,
      setSelectedConnectionIds,
      setSelectedTreeKeys,
      setConnectionSelectionAnchorId
    )
    return
  }

  selectConnectionTreeNodes(
    [node.connectionId],
    node.connectionId,
    setSelectedConnectionIds,
    setSelectedTreeKeys,
    setConnectionSelectionAnchorId
  )
}
