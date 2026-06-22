import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  type MotionValue,
  type SpringOptions
} from 'motion/react'
import React, { Children, cloneElement, useEffect, useMemo, useRef, useState } from 'react'
import './react-bits-dock.css'

export type ReactBitsDockItem = {
  key: string
  icon: React.ReactNode
  label: React.ReactNode
  onClick: () => void
  active?: boolean
}

type ReactBitsDockProps = {
  items: ReactBitsDockItem[]
  className?: string
  distance?: number
  panelHeight?: number
  baseItemSize?: number
  dockHeight?: number
  magnification?: number
  disableMagnification?: boolean
  spring?: SpringOptions
}

type DockItemProps = {
  children: React.ReactNode
  onClick?: () => void
  mouseX: MotionValue<number>
  spring: SpringOptions
  distance: number
  baseItemSize: number
  magnification: number
  disableMagnification?: boolean
  label?: React.ReactNode
  active?: boolean
}

type DockIconProps = {
  children: React.ReactNode
  active?: boolean
}

type DockLabelProps = {
  children: React.ReactNode
  isHovered?: MotionValue<number>
}

function DockLabel({ children, isHovered }: DockLabelProps) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (!isHovered) {
      return
    }
    const unsubscribe = isHovered.on('change', (latest) => {
      setIsVisible(latest === 1)
    })
    return () => unsubscribe()
  }, [isHovered])

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: -8 }}
          exit={{ opacity: 0, y: 2 }}
          transition={{ duration: 0.18 }}
          className="rb-dock-label"
          role="tooltip"
          style={{ x: '-50%' }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function DockIcon({ children, active }: DockIconProps) {
  return <div className={`rb-dock-icon${active ? ' is-active' : ''}`}>{children}</div>
}

function DockItem({
  children,
  onClick,
  mouseX,
  spring,
  distance,
  baseItemSize,
  magnification,
  disableMagnification,
  label,
  active
}: DockItemProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const isHovered = useMotionValue(0)

  const mouseDistance = useTransform(mouseX, (value) => {
    const rect = ref.current?.getBoundingClientRect() ?? { x: 0, width: baseItemSize }
    return value - rect.x - baseItemSize / 2
  })

  const magnifiedScale = Math.max(1, magnification / baseItemSize)
  const targetScale = disableMagnification
    ? useTransform(mouseDistance, () => 1)
    : useTransform(mouseDistance, [-distance, 0, distance], [1, magnifiedScale, 1])
  const scale = useSpring(targetScale, spring)

  return (
    <motion.button
      ref={ref}
      type="button"
      style={{ width: baseItemSize, height: baseItemSize, scale }}
      onHoverStart={() => isHovered.set(1)}
      onHoverEnd={() => isHovered.set(0)}
      onFocus={() => isHovered.set(1)}
      onBlur={() => isHovered.set(0)}
      onClick={onClick}
      className={`rb-dock-item${active ? ' is-active' : ''}`}
      aria-label={typeof label === 'string' ? label : undefined}
      title={typeof label === 'string' ? label : undefined}
    >
      {Children.map(children, (child) =>
        React.isValidElement(child)
          ? cloneElement(child as React.ReactElement<{ active?: boolean; isHovered?: MotionValue<number> }>, {
              active,
              isHovered
            })
          : child
      )}
    </motion.button>
  )
}

export default function ReactBitsDock({
  items,
  className = '',
  spring = { mass: 0.1, stiffness: 150, damping: 12 },
  magnification = 40,
  disableMagnification = false,
  distance = 100,
  panelHeight = 30,
  dockHeight = 36,
  baseItemSize = 28
}: ReactBitsDockProps) {
  const mouseX = useMotionValue(Infinity)
  const height = useMemo(() => dockHeight, [dockHeight])

  return (
    <motion.div style={{ height }} className={`rb-dock-outer ${className}`.trim()}>
      <motion.div
        className="rb-dock-panel"
        style={{ height: panelHeight }}
        onMouseMove={({ pageX }) => {
          mouseX.set(pageX)
        }}
        onMouseLeave={() => {
          mouseX.set(Infinity)
        }}
        role="toolbar"
        aria-label="树工具栏"
      >
        {items.map((item) => (
          <DockItem
            key={item.key}
            onClick={item.onClick}
            mouseX={mouseX}
            spring={spring}
            distance={distance}
            magnification={magnification}
            baseItemSize={baseItemSize}
            disableMagnification={disableMagnification}
            label={item.label}
            active={item.active}
          >
            <DockIcon active={item.active}>{item.icon}</DockIcon>
            <DockLabel>{item.label}</DockLabel>
          </DockItem>
        ))}
      </motion.div>
    </motion.div>
  )
}
