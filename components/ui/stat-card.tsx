import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: ReactNode;
  helper?: string;
  icon?: ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
};

const toneClasses = {
  default: "bg-secondary/80 text-secondary-foreground ring-black/[0.05]",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
};

export function StatCard({ label, value, helper, icon, tone = "default" }: StatCardProps) {
  return (
    <Card className="relative overflow-hidden bg-card/82 shadow-[0_18px_50px_rgba(28,20,16,0.06)]">
      <div className="pointer-events-none absolute -right-10 -top-14 size-28 rounded-full bg-accent/14 blur-2xl" />
      <CardContent className="relative flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </p>
          <div className="text-2xl font-semibold tracking-[-0.03em]">{value}</div>
          {helper ? <p className="text-xs text-muted-foreground">{helper}</p> : null}
        </div>
        {icon ? (
          <div
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-xl ring-1",
              toneClasses[tone]
            )}
          >
            {icon}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
