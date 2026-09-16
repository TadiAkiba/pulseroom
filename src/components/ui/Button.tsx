import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { buttonClasses } from './buttonClasses.ts'
import type { ButtonSize, ButtonVariant } from './buttonClasses.ts'

export function Button({
  variant = 'default',
  size = 'md',
  block = false,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  children: ReactNode
}) {
  return (
    <button
      {...props}
      className={buttonClasses({
        variant,
        size,
        block,
        className,
      })}
    >
      {children}
    </button>
  )
}
