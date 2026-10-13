import { Toaster as Sonner, type ToasterProps } from "sonner"
import { useTheme } from "@/context/ThemeContext"

// Empty fragment to hide all toast icons
const NoIcon = () => <></>

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedMode } = useTheme()

  return (
    <Sonner
      theme={resolvedMode as ToasterProps["theme"]}
      position="top-right"
      closeButton
      richColors={false}
      swipeDirections={["right"]}
      className="toaster group"
      icons={{
        success: <NoIcon />,
        info: <NoIcon />,
        warning: <NoIcon />,
        error: <NoIcon />,
        loading: <NoIcon />,
      }}
      toastOptions={{
        className: "!rounded-[var(--radius-card)] group",
        // G9 P-09-31: the toast body reads the secondary text tier (not the
        // muted/70% tier) and the action honours the 28px control floor.
        classNames: {
          content: "text-[var(--text-secondary)]",
          actionButton: "min-h-[var(--control-hit-min)]",
        },
      }}
      style={
        {
          "--normal-bg": "transparent",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "transparent",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
