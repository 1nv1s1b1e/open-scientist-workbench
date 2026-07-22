import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import * as React from 'react'
import { cn } from '@/lib/utils/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-normal transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // xAI white-filled pill (rare primary CTA)
        default: 'bg-white text-[#0a0a0a] border border-white hover:bg-white/90',
        // xAI canonical white-outline pill on dark
        outline:
          'bg-transparent text-white border border-white/16 hover:border-white/40 hover:bg-white/[0.04]',
        ghost: 'text-white hover:bg-white/[0.04] border border-transparent',
        destructive:
          'bg-transparent text-red-400 border border-red-500/30 hover:border-red-500/60 hover:bg-red-500/[0.06]',
        // subtle secondary — surface-soft fill
        secondary:
          'bg-[var(--color-surface-soft)] text-white border border-[var(--color-border)] hover:border-white/30',
        link: 'text-white underline-offset-4 hover:underline border-none bg-transparent',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 text-xs',
        lg: 'h-11 px-6 text-base',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'outline', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
