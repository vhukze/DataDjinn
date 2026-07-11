import { LoadingOutlined } from '@ant-design/icons'
import { Modal } from 'antd'
import { forwardRef, memo, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import SqlEditor from '../components/SqlEditor'
import type { SqlDialect } from '../components/SqlEditor'

export type DdlPreviewModalHandle = {
  open: (payload: { title: string; dialect: SqlDialect; load: () => Promise<string> }) => void
}

export const DdlPreviewModal = memo(
  forwardRef<
    DdlPreviewModalHandle,
    {
      theme: 'dark' | 'light'
      onError: (message: string) => void
    }
  >(function DdlPreviewModal({ theme, onError }, ref) {
    const [open, setOpen] = useState(false)
    const [title, setTitle] = useState('')
    const [content, setContent] = useState('')
    const [loading, setLoading] = useState(false)
    const [dialect, setDialect] = useState<SqlDialect>('sqlite')

    useImperativeHandle(
      ref,
      () => ({
        open: ({ title, dialect, load }) => {
          setTitle(title)
          setContent('')
          setDialect(dialect)
          setLoading(true)
          setOpen(true)
          window.setTimeout(() => {
            void load()
              .then((nextContent) => {
                setContent(nextContent)
              })
              .catch((err) => {
                setOpen(false)
                onError(err instanceof Error ? err.message : '获取 DDL 失败')
              })
              .finally(() => {
                setLoading(false)
              })
          }, 0)
        }
      }),
      [onError]
    )

    return (
      <Modal
        title={title || '查看 DDL'}
        open={open}
        footer={null}
        onCancel={() => setOpen(false)}
        width={980}
        centered
        maskClosable={false}
        transitionName=""
        maskTransitionName=""
      >
        <div className="ddl-preview-shell">
          <SqlEditor
            value={loading ? '-- 加载中...' : content}
            onChange={() => undefined}
            theme={theme}
            readOnly
            height="60vh"
            completionContext={{ dialect }}
          />
        </div>
      </Modal>
    )
  })
)

export type ImperativeModalHandle = {
  open: () => void
  close: () => void
}

export const ImperativeModalHost = memo(
  forwardRef<
    ImperativeModalHandle,
    {
      title: string
      width?: number
      footer?: React.ReactNode | null
      maskClosable?: boolean
      className?: string
      deferContentMount?: boolean
      loadingFallback?: ReactNode
      children: ReactNode | ((contentReady: boolean) => ReactNode)
      onClosed?: () => void
    }
  >(function ImperativeModalHost(
    {
      title,
      width,
      footer = null,
      maskClosable = false,
      className,
      deferContentMount = false,
      loadingFallback,
      children,
      onClosed
    },
    ref
  ) {
    const [open, setOpen] = useState(false)
    const [contentReady, setContentReady] = useState(false)
    const frameRef = useRef<number | undefined>(undefined)

    useImperativeHandle(
      ref,
      () => ({
        open: () => setOpen(true),
        close: () => setOpen(false)
      }),
      []
    )

    useEffect(() => {
      if (frameRef.current != null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = undefined
      }

      if (!open) {
        setContentReady(false)
        return
      }

      if (!deferContentMount) {
        setContentReady(true)
        return
      }

      setContentReady(false)
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = undefined
        setContentReady(true)
      })

      return () => {
        if (frameRef.current != null) {
          window.cancelAnimationFrame(frameRef.current)
          frameRef.current = undefined
        }
      }
    }, [deferContentMount, open])

    const resolvedChildren =
      typeof children === 'function'
        ? children(contentReady || !deferContentMount)
        : contentReady || !deferContentMount
          ? children
          : (loadingFallback ?? (
              <div className="deferred-modal-loading">
                <LoadingOutlined spin />
              </div>
            ))

    return (
      <Modal
        title={title}
        open={open}
        width={width}
        footer={footer}
        className={className}
        maskClosable={maskClosable}
        destroyOnHidden
        transitionName=""
        maskTransitionName=""
        afterOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setContentReady(false)
            onClosed?.()
          }
        }}
        onCancel={() => {
          setOpen(false)
        }}
      >
        {resolvedChildren}
      </Modal>
    )
  })
)
