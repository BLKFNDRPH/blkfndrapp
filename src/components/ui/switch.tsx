"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * An on/off switch: a button with role="switch", so a screen reader announces
 * it as on or off and Space or Enter flips it. Written here rather than pulling
 * in @radix-ui/react-switch for one control.
 */
interface SwitchProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, className, onClick, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      data-state={checked ? "checked" : "unchecked"}
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) onCheckedChange?.(!checked)
      }}
      className={cn(
        "peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
        className
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none block h-5 w-5 rounded-full shadow-lg ring-0 transition-transform",
          // Off, the knob is grey rather than the page colour, so the two
          // states differ by more than position in the dark theme too.
          checked ? "translate-x-5 bg-background" : "translate-x-0 bg-muted-foreground"
        )}
      />
    </button>
  )
)
Switch.displayName = "Switch"

export { Switch }
