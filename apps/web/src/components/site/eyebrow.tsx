import { cn } from '@/lib/utils/cn'

interface EyebrowProps extends React.HTMLAttributes<HTMLSpanElement> {
  children: React.ReactNode
  size?: 'sm' | 'lg'
}

export function Eyebrow({ children, size = 'sm', className, ...props }: EyebrowProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 font-mono uppercase',
        size === 'sm'
          ? 'text-[13px] tracking-[1.4px] text-muted'
          : 'text-[15px] tracking-[1.4px] text-white',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  )
}
