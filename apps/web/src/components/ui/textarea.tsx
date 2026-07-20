import * as React from 'react'
import { cn } from '@/lib/utils/cn'

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      'flex min-h-[80px] w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-soft)] px-4 py-3 text-sm font-normal text-white transition-all placeholder:text-[var(--color-text-muted)] hover:border-white/20 focus-visible:border-white/40 focus-visible:bg-[var(--color-surface)] focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    ref={ref}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export { Textarea }
