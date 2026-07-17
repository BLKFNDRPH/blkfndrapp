
"use client"

import { isValidElement, type ReactNode } from "react"
import { useToast } from "@/hooks/use-toast"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"
import { Button } from "./button"
import { Copy } from "lucide-react"

export function Toaster() {
  const { toasts, toast: showToast } = useToast()

  const handleCopy = (title?: ReactNode, description?: ReactNode) => {
    const titleText = typeof title === 'string' ? title : '';
    const descriptionText = typeof description === 'string' ? description : isValidElement(description) ? (description.props.children as string) : '';
    const textToCopy = `${titleText}\n${descriptionText}`.trim();
    navigator.clipboard.writeText(textToCopy);
    showToast({
      title: "Copied to clipboard!",
      description: "The error message has been copied.",
    })
  }

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, isError, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="flex-1 min-w-0">
              <div className="grid gap-1">
                {title && <ToastTitle>{title}</ToastTitle>}
                {description && (
                  <ToastDescription>{description}</ToastDescription>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 self-start flex-shrink-0">
              {isError && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopy(title, description)}
                  className="group-[.destructive]:hover:bg-red-900 group-[.destructive]:hover:text-white"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              )}
              {action}
            </div>
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
