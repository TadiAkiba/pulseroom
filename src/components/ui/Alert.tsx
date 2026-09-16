import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'

type AlertVariant = 'info' | 'success' | 'warning' | 'danger'

export function Alert({
  title,
  children,
  variant = 'info',
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  title?: ReactNode
  children: ReactNode
  variant?: AlertVariant
}) {
  return (
    <div {...props} className={cn('ui-alert', `ui-alert--${variant}`, className)}>
      {title ? <strong className="ui-alert__title">{title}</strong> : null}
      <div className="ui-alert__body">{children}</div>
    </div>
  )
}
