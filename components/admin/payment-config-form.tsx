"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, Loader2 } from "lucide-react";

export function PaymentConfigForm() {
  const [publicKey, setPublicKey] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [isSandbox, setIsSandbox] = useState(true);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch("/api/merchant/payments", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "LIQPAY",
          isEnabled: true,
          isSandbox,
          config: { publicKey, privateKey },
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
    <form onSubmit={handleSubmit} className="mt-4 space-y-4">
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
          placeholder="sandbox_private_key"
          required
        />
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
        Зберегти LiqPay
      </Button>
    </form>
  );
}
