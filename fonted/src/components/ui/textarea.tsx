import * as React from 'react'

import { cn } from '@/lib/utils'

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<'textarea'>
>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      'flex min-h-[100px] w-full resize-y rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 shadow-sm transition-colors',
      'placeholder:text-zinc-600',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    ref={ref}
    {...props}
  />
))
Textarea.displayName = 'Textarea'

export { Textarea }
