import { cn } from '../../lib/cn.ts'

export type ButtonVariant = 'default' | 'secondary' | 'outline' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export function buttonClasses({
  variant = 'default',
  size = 'md',
  block = false,
  className,
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  className?: string
}) {
  return cn(
    'ui-button',
    `ui-button--${variant}`,
    `ui-button--${size}`,
    block && 'ui-button--block',
    className,
  )
}
