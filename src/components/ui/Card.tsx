import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'

export function Card({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return (
    <article {...props} className={cn('panel ui-card', className)}>
      {children}
    </article>
  )
}

export function CardHeader({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div {...props} className={cn('ui-card__header', className)}>
      {children}
    </div>
  )
}

export function CardTitle({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement> & { children: ReactNode }) {
  return (
    <h2 {...props} className={cn('ui-card__title', className)}>
      {children}
    </h2>
  )
}

export function CardDescription({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement> & { children: ReactNode }) {
  return (
    <p {...props} className={cn('ui-card__description', className)}>
      {children}
    </p>
  )
}

export function CardContent({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div {...props} className={cn('ui-card__content', className)}>
      {children}
    </div>
  )
}
