import * as React from 'react'
import { cn } from '@/lib/utils/cn'

const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    // biome-ignore lint/a11y/noLabelWithoutControl: label 关联由 htmlFor 或 Radix Slot 在调用处处理
    <label
      ref={ref}
      className={cn(
        'font-mono text-[11px] font-normal uppercase leading-none tracking-[1.2px] text-muted peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  ),
)
Label.displayName = 'Label'

export { Label }
