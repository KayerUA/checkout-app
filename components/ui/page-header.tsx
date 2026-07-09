import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
  className,
}: PageHeaderProps) {
  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-[1.75rem] border bg-card/72 p-5 shadow-[0_24px_70px_rgba(28,20,16,0.07)] ring-1 ring-white/60 backdrop-blur-xl sm:flex sm:items-end sm:justify-between sm:gap-4 sm:p-6",
        className
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/90" />
      <div className="pointer-events-none absolute -top-24 right-8 size-48 rounded-full bg-accent/18 blur-3xl" />
      <div className="min-w-0 space-y-1">
        {eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="relative mt-4 shrink-0 sm:mt-0">{action}</div> : null}
    </section>
  );
}
