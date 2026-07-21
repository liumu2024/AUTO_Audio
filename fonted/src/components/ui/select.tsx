import * as React from 'react'

import { cn } from '@/lib/utils'

const Select = React.forwardRef<
  HTMLSelectElement,
  React.ComponentProps<'select'>
>(({ className, children, ...props }, ref) => (
  <select
    className={cn(
      'flex h-9 w-full cursor-pointer appearance-none rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1 pr-8 text-sm text-zinc-100 shadow-sm transition-colors',
      'bg-[length:16px] bg-[position:right_0.5rem_center] bg-no-repeat',
      "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
      'disabled:cursor-not-allowed disabled:opacity-50',
      '[&>option]:bg-zinc-950 [&>option]:text-zinc-100 [&>option:checked]:bg-blue-600 [&>option:disabled]:text-zinc-500',
      className,
    )}
    ref={ref}
    {...props}
  >
    {children}
  </select>
))
Select.displayName = 'Select'

export { Select }
