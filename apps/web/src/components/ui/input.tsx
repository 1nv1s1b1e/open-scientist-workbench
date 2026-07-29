import * as React from 'react'
import { cn } from '@/lib/utils/cn'

// xAI text-input: canvas-soft bg, hairline border, 8px radius, no shadow
const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(
        'flex h-11 w-full rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-soft)] px-4 py-2 text-sm font-normal text-white transition-all placeholder:text-[var(--color-text-muted)] hover:border-white/20 focus-visible:border-white/40 focus-visible:bg-[var(--color-surface)] focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export { Input }
