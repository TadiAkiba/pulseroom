import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'

type BadgeVariant = 'default' | 'info' | 'success' | 'warning' | 'danger' | 'outline'

export function Badge({
  children,
  variant = 'default',
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  children: ReactNode
  variant?: BadgeVariant
}) {
  return (
    <span {...props} className={cn('ui-badge', `ui-badge--${variant}`, className)}>
      {children}
    </span>
  )
}
