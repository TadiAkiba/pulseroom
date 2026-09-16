import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn.ts'

export function Progress({
  value,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  value: number
}) {
  const safeValue = Math.max(0, Math.min(100, value))

  return (
    <div
      {...props}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={safeValue}
      role="progressbar"
      className={cn('ui-progress', className)}
    >
      <div className="ui-progress__fill" style={{ width: `${safeValue}%` }} />
    </div>
  )
}
