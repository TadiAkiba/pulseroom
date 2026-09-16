import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'

export function Tabs({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div {...props} className={cn('ui-tabs', className)}>
      {children}
    </div>
  )
}

export function TabsList({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div {...props} className={cn('ui-tabs__list', className)}>
      {children}
    </div>
  )
}

export function TabsTrigger({
  active = false,
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean
  children: ReactNode
}) {
  return (
    <button
      {...props}
      className={cn('ui-tabs__trigger', active && 'ui-tabs__trigger--active', className)}
      type={props.type ?? 'button'}
    >
      {children}
    </button>
  )
}
