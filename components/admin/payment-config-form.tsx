"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Loader2 } from "lucide-react";

export type PaymentConfigInitial = {
  isEnabled: boolean;
  isSandbox: boolean;
  publicKey: string;
  hasPrivateKey: boolean;
};

export function PaymentConfigForm({ initial }: { initial: PaymentConfigInitial }) {
  const [publicKey, setPublicKey] = useState(initial.publicKey);
  const [privateKey, setPrivateKey] = useState("");
  const [isEnabled, setIsEnabled] = useState(initial.isEnabled);
  const [isSandbox, setIsSandbox] = useState(initial.isSandbox);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const config: Record<string, string> = { publicKey };
      if (privateKey.trim()) config.privateKey = privateKey.trim();

      const res = await fetch("/api/merchant/payments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "LIQPAY",
          isEnabled,
          isSandbox,
          config,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to save");
      }
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка збереження");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={isEnabled ? "default" : "secondary"}>
          {isEnabled ? "LiqPay увімкнено" : "LiqPay вимкнено"}
        </Badge>
        <Badge variant="outline">{isSandbox ? "Sandbox" : "Live"}</Badge>
        {initial.hasPrivateKey && <Badge variant="outline">Private key збережено</Badge>}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isEnabled}
          onChange={(e) => setIsEnabled(e.target.checked)}
        />
        Увімкнути оплату карткою через LiqPay
      </label>

      <div className="space-y-2">
        <Label htmlFor="publicKey">LiqPay Public Key</Label>
        <Input
          id="publicKey"
          value={publicKey}
          onChange={(e) => setPublicKey(e.target.value)}
          placeholder="i00000000000"
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="privateKey">LiqPay Private Key</Label>
        <Input
          id="privateKey"
          type="password"
          value={privateKey}
          onChange={(e) => setPrivateKey(e.target.value)}
          placeholder={initial.hasPrivateKey ? "Залиште порожнім, щоб не змінювати" : "private_key"}
          required={!initial.hasPrivateKey && isEnabled}
        />
        <p className="text-xs text-muted-foreground">
          Private key не показується назад після збереження. Якщо поле порожнє,
          використовується вже збережений ключ.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isSandbox}
          onChange={(e) => setIsSandbox(e.target.checked)}
        />
        Sandbox mode (тестові ключі)
      </label>
      <p className="text-xs text-muted-foreground">
        Callback URL для LiqPay:{" "}
        <code className="rounded bg-muted px-1">
          {typeof window !== "undefined" ? window.location.origin : ""}/api/callbacks/liqpay
        </code>
      </p>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertDescription>LiqPay збережено</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={loading}>
        {loading && <Loader2 className="size-4 animate-spin" />}
        {isEnabled ? "Зберегти та увімкнути LiqPay" : "Зберегти та вимкнути LiqPay"}
      </Button>
    </form>
  );
}
