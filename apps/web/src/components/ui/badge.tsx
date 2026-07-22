import { cva, type VariantProps } from 'class-variance-authority'
import type * as React from 'react'
import { cn } from '@/lib/utils/cn'

// xAI badges — mono-uppercase, hairline border, pill or 6px
const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-normal uppercase tracking-[1.2px] transition-colors focus:outline-none',
  {
    variants: {
      variant: {
        default: 'border-white/16 bg-white/[0.04] text-white',
        outline: 'border-white/16 text-white',
        destructive: 'border-red-500/30 bg-red-500/[0.06] text-red-400',
        success: 'border-emerald-500/30 bg-emerald-500/[0.08] text-emerald-300',
        warning: 'border-amber-500/30 bg-amber-500/[0.08] text-amber-300',
        secondary:
          'border-[var(--color-border)] bg-[var(--color-surface-soft)] text-[var(--color-body)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
