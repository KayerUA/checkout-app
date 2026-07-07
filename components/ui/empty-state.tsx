import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type EmptyStateProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed bg-secondary/40 px-6 py-8 text-center",
        className
      )}
    >
      {icon ? (
        <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-background text-muted-foreground ring-1 ring-border">
          {icon}
        </div>
      ) : null}
      <h2 className="text-sm font-semibold">{title}</h2>
      {description ? (
        <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
