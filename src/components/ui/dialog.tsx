"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

const centerContentClass =
  "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] max-h-[85dvh] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"

// モバイル幅では画面下からのボトムシート、md以上では従来通り中央のダイアログに戻る
const sheetContentClass = cn(
  "fixed z-50 grid w-full gap-4 overflow-y-auto bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-150 outline-none",
  "inset-x-0 bottom-0 top-auto left-0 right-0 translate-x-0 translate-y-0 max-h-[85dvh] rounded-t-2xl rounded-b-none pt-2",
  "pb-[calc(1rem+env(safe-area-inset-bottom))]",
  "data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-bottom",
  "md:top-1/2 md:bottom-auto md:max-w-sm md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:pt-4 md:pb-4 md:left-1/2 md:right-auto",
  "md:data-open:zoom-in-95 md:data-open:slide-in-from-bottom-0 md:data-closed:zoom-out-95 md:data-closed:slide-out-to-bottom-0"
)

// モバイル幅では画面上からのドロップダウンシート、md以上では従来通り中央のダイアログに戻る
const topContentClass = cn(
  "fixed z-50 grid w-full gap-4 overflow-y-auto bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 duration-150 outline-none",
  "inset-x-0 top-0 bottom-auto left-0 right-0 translate-x-0 translate-y-0 max-h-[85dvh] rounded-b-2xl rounded-t-none pb-2",
  "pt-[calc(1rem+env(safe-area-inset-top))]",
  "data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-top data-closed:animate-out data-closed:fade-out-0 data-closed:slide-out-to-top",
  "md:top-1/2 md:bottom-auto md:max-w-sm md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl md:pt-4 md:pb-4 md:left-1/2 md:right-auto",
  "md:data-open:zoom-in-95 md:data-open:slide-in-from-top-0 md:data-closed:zoom-out-95 md:data-closed:slide-out-to-top-0"
)

function DialogContent({
  className,
  children,
  showCloseButton = true,
  variant = "center",
  onDismiss,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  variant?: "center" | "sheet" | "top"
  /** variant="sheet" の時、ハンドルを下にドラッグして閉じた際に呼ばれる */
  onDismiss?: () => void
}) {
  const popupRef = React.useRef<HTMLDivElement>(null)
  const dragStartY = React.useRef<number | null>(null)

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    dragStartY.current = e.clientY
    e.currentTarget.setPointerCapture(e.pointerId)
    if (popupRef.current) popupRef.current.style.transition = "none"
  }
  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragStartY.current == null || !popupRef.current) return
    const dy = Math.max(0, e.clientY - dragStartY.current)
    popupRef.current.style.transform = `translateY(${dy}px)`
  }
  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (dragStartY.current == null) return
    const dy = Math.max(0, e.clientY - dragStartY.current)
    if (popupRef.current) {
      popupRef.current.style.transition = ""
      popupRef.current.style.transform = ""
    }
    dragStartY.current = null
    if (dy > 60) onDismiss?.()
  }

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        ref={popupRef}
        data-slot="dialog-content"
        className={cn(
          variant === "sheet" ? sheetContentClass : variant === "top" ? topContentClass : centerContentClass,
          className
        )}
        {...props}
      >
        {variant === "sheet" && (
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="mx-auto -mt-1 mb-1 h-4 w-16 shrink-0 flex items-center justify-center touch-none cursor-grab md:hidden"
          >
            <div className="h-1 w-9 rounded-full bg-foreground/15" />
          </div>
        )}
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon
            />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
