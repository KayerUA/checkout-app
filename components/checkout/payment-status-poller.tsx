"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

type PaymentStatusResponse = {
  status: string;
  paymentStatus: string | null;
  orderLink: { shopifyOrderName?: string | null } | null;
};

export function PaymentStatusPoller({ publicToken }: { publicToken: string }) {
  const [message, setMessage] = useState("Перевіряємо статус оплати в LiqPay...");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function checkStatus() {
      try {
        const res = await fetch(`/api/public/checkout-sessions/${publicToken}/status`, {
          cache: "no-store",
        });
        const data = (await res.json()) as PaymentStatusResponse;
        if (cancelled) return;

        if (data.paymentStatus === "FAILED") {
          setFailed(true);
          setMessage("Оплата не пройшла. Поверніться до checkout і спробуйте ще раз.");
          return;
        }

        if (data.status === "PAID" || data.status === "COMPLETED" || data.orderLink) {
          setMessage("Оплату підтверджено. Готуємо сторінку замовлення...");
          window.setTimeout(() => window.location.reload(), 500);
          return;
        }

        setMessage("Оплата ще підтверджується. Це може зайняти кілька секунд.");
      } catch {
        if (!cancelled) {
          setMessage("Не вдалося перевірити статус. Продовжуємо автоматично оновлювати.");
        }
      }
    }

    checkStatus();
    const interval = window.setInterval(checkStatus, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [publicToken]);

  return (
    <div className="rounded-md border border-dashed p-3 text-sm">
      <div className="flex items-start gap-2">
        {failed ? (
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
        ) : (
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" />
        )}
        <div>
          <p className="font-medium">
            {failed ? "Оплату не підтверджено" : "Очікуємо підтвердження"}
          </p>
          <p className="mt-1 text-muted-foreground">{message}</p>
        </div>
      </div>
    </div>
  );
}
