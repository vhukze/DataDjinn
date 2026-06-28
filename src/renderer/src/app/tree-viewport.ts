import { useEffect, useMemo, useState } from 'react'
import type { RefObject } from 'react'
import type { DatabaseTreeNode } from './tree-model'

type ResourceTreeViewportOptions = {
  treeData: DatabaseTreeNode[]
  resourceTreeViewportRef: RefObject<HTMLDivElement | null>
}

type ResourceTreeViewportState = {
  enableVirtualTree: boolean
  resourceTreeHeight: number
}

const VIRTUAL_TREE_THRESHOLD = 240

export const useResourceTreeViewport = ({
  treeData,
  resourceTreeViewportRef
}: ResourceTreeViewportOptions): ResourceTreeViewportState => {
  const [resourceTreeHeight, setResourceTreeHeight] = useState(360)

  const resourceTreeNodeCount = useMemo(() => {
    let count = 0
    const walk = (nodes: DatabaseTreeNode[]): void => {
      for (const node of nodes) {
        count += 1
        if (node.children?.length) {
          walk(node.children)
        }
      }
    }
    walk(treeData)
    return count
  }, [treeData])

  const enableVirtualTree = resourceTreeNodeCount > VIRTUAL_TREE_THRESHOLD

  useEffect(() => {
    const element = resourceTreeViewportRef.current
    if (!element) {
      return
    }

    const updateTreeHeight = (): void => {
      const nextHeight = Math.max(240, Math.floor(element.clientHeight))
      setResourceTreeHeight((current) => (current === nextHeight ? current : nextHeight))
    }

    updateTreeHeight()
    const observer = new ResizeObserver(updateTreeHeight)
    observer.observe(element)

    return () => observer.disconnect()
  }, [resourceTreeViewportRef])

  return {
    enableVirtualTree,
    resourceTreeHeight
  }
}
