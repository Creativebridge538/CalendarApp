import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cn } from "@/lib/utils"

/** キャストのモバイル画面用、下部タブバーの上に浮かぶ主要アクションボタン */
function Fab({ className, ...props }: ButtonPrimitive.Props) {
  return (
    <ButtonPrimitive
      data-slot="fab"
      className={cn(
        "fixed right-4 z-40 flex h-[60px] w-[60px] items-center justify-center rounded-full border-[3px] border-white",
        "bottom-[calc(4rem+env(safe-area-inset-bottom)+12px)]",
        "bg-[var(--brand-accent)] text-white",
        "shadow-[var(--elevation-fab)] outline-none transition-transform duration-150",
        "active:scale-90 active:shadow-[var(--elevation-fab-pressed)]",
        "[&_svg]:pointer-events-none [&_svg]:size-6 [&_svg]:shrink-0",
        className
      )}
      {...props}
    />
  )
}

export { Fab }
