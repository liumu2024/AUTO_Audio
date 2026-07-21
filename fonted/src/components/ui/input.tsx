import * as React from 'react'

import { cn } from '@/lib/utils'

const inputClassName = cn(
  'flex h-9 w-full rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1 text-sm text-zinc-100 shadow-sm transition-colors',
  'placeholder:text-zinc-600',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
  'disabled:cursor-not-allowed disabled:opacity-50',
)

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<'input'>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn(inputClassName, className)}
      ref={ref}
      {...props}
    />
  ),
)
Input.displayName = 'Input'

export { Input, inputClassName }
