"use client";

import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

const STEPS = [
  { id: 1, label: "Контакти" },
  { id: 2, label: "Доставка" },
  { id: 3, label: "Оплата" },
] as const;

type Step = 1 | 2 | 3;

export function CheckoutProgress({ currentStep }: { currentStep: Step }) {
  return (
    <nav aria-label="Прогрес оформлення" className="mb-6 sm:mb-8">
      <ol className="flex items-center justify-center rounded-2xl border bg-card/80 px-4 py-3 shadow-sm shadow-black/5">
        {STEPS.map((step, index) => {
          const done = step.id < currentStep;
          const active = step.id === currentStep;
          return (
            <li key={step.id} className="flex items-center">
              <div className="flex flex-col items-center gap-2">
                <div
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full border text-xs font-medium transition-colors",
                    done && "border-primary bg-primary text-primary-foreground",
                    active && !done && "border-primary bg-background text-foreground",
                    !done && !active && "border-border bg-background text-muted-foreground"
                  )}
                >
                  {done ? <Check className="size-4" /> : step.id}
                </div>
                <span
                  className={cn(
                    "text-[10px] uppercase tracking-wider",
                    active || done ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {step.label}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <div
                  className={cn(
                    "mx-3 mb-5 h-px w-8 sm:mx-5 sm:w-20",
                    step.id < currentStep ? "bg-primary" : "bg-border"
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
