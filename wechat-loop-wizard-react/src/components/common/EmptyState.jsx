import * as React from "react"
import PropTypes from "prop-types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/**
 * 空状态
 * @param {object} props
 * @param {React.ComponentType<{className?: string}>} props.icon Lucide 图标组件
 * @param {string} props.title
 * @param {string} [props.description]
 * @param {React.ReactNode} [props.action] 主按钮
 * @param {string} [props.className]
 */
export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed bg-surface/60 px-6 py-16 text-center",
        className
      )}
      role="status"
    >
      {Icon && (
        <Icon className="h-10 w-10 text-muted-foreground/60" aria-hidden="true" />
      )}
      <h3 className="font-serif text-xl font-semibold tracking-tight text-foreground">
        {title}
      </h3>
      {description && (
        <p className="max-w-sm text-sm leading-7 text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

EmptyState.propTypes = {
  icon: PropTypes.elementType,
  title: PropTypes.string.isRequired,
  description: PropTypes.string,
  action: PropTypes.node,
  className: PropTypes.string,
}
