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
  default: "bg-secondary text-secondary-foreground",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  warning: "bg-amber-50 text-amber-700 ring-amber-200",
  danger: "bg-red-50 text-red-700 ring-red-200",
};

export function StatCard({ label, value, helper, icon, tone = "default" }: StatCardProps) {
  return (
    <Card className="bg-card/90 shadow-sm shadow-black/5">
      <CardContent className="flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </p>
          <div className="text-2xl font-semibold tracking-tight">{value}</div>
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
