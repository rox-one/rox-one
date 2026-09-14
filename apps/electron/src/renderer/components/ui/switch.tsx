"use client"

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer group relative inline-flex h-[28px] w-[36px] shrink-0 items-center justify-center rounded-full bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none flex h-[18px] w-[32px] items-center rounded-full bg-foreground/30 p-[2px] transition-colors duration-[var(--motion-fast)] group-data-[state=checked]:bg-accent"
      >
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className="pointer-events-none block size-[14px] shrink-0 rounded-full bg-surface-document shadow-sm transition-transform duration-[var(--motion-fast)] data-[state=checked]:translate-x-[14px] data-[state=unchecked]:translate-x-0"
        />
      </span>
    </SwitchPrimitive.Root>
  )
}

export { Switch }
