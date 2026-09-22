import { useEffect, type HTMLAttributes, type ReactNode } from 'react'

type DialogProps = {
  open: boolean
  onClose?: () => void
  children?: ReactNode
  role?: 'dialog' | 'alertdialog'
} & HTMLAttributes<HTMLDivElement>

export function Dialog({ open, onClose, children, role = 'dialog', className = '', ...rest }: DialogProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      data-dialog-root
      className={`dialog-backdrop ${className}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
      {...rest}
    >
      <div
        data-dialog-panel
        className="dialog-panel"
        role={role}
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  )
}

export function DialogHeader({ children, className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`dialog-header ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function DialogTitle({ children, className = '', ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={`dialog-title ${className}`} {...rest}>
      {children}
    </h2>
  )
}

export function DialogDescription({ children, className = '', ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={`dialog-description ${className}`} {...rest}>
      {children}
    </p>
  )
}

export function DialogContent({ children, className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`dialog-content ${className}`} {...rest}>
      {children}
    </div>
  )
}

export function DialogFooter({ children, className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`dialog-footer ${className}`} {...rest}>
      {children}
    </div>
  )
}
