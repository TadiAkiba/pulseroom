import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { cn } from '../../lib/cn.ts'

export function Field({
  label,
  description,
  children,
  className,
}: {
  label?: ReactNode
  description?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('ui-field', className)}>
      {label ? <span className="ui-field__label">{label}</span> : null}
      {description ? <span className="ui-field__description">{description}</span> : null}
      {children}
    </label>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn('ui-input', props.className)} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn('ui-textarea', props.className)} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn('ui-select', props.className)} />
}
