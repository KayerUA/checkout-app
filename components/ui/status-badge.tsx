import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const statusTone: Record<string, string> = {
  PAID: "border-emerald-200 bg-emerald-50 text-emerald-700",
  COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  DONE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  MATCHED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  READY: "border-blue-200 bg-blue-50 text-blue-700",
  PAYMENT_PENDING: "border-amber-200 bg-amber-50 text-amber-700",
  PENDING: "border-amber-200 bg-amber-50 text-amber-700",
  WAITING_BANK_PAYMENT: "border-amber-200 bg-amber-50 text-amber-700",
  ABANDONED: "border-zinc-200 bg-zinc-50 text-zinc-700",
  FAILED: "border-red-200 bg-red-50 text-red-700",
  ERROR: "border-red-200 bg-red-50 text-red-700",
  NEEDS_REVIEW: "border-red-200 bg-red-50 text-red-700",
  REFUNDED: "border-violet-200 bg-violet-50 text-violet-700",
  SHIPPED: "border-sky-200 bg-sky-50 text-sky-700",
  FISCALIZED: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

export function StatusBadge({
  status,
  className,
}: {
  status?: string | null;
  className?: string;
}) {
  const label = status || "n/a";
  return (
    <Badge
      variant="outline"
      className={cn("capitalize", statusTone[label.toUpperCase()] ?? "", className)}
    >
      {label.toLowerCase().replaceAll("_", " ")}
    </Badge>
  );
}
