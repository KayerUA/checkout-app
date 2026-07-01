"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";

export function ShippingConfigForm() {
  const [flatRateUah, setFlatRateUah] = useState("90");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    const kopiyky = Math.round(parseFloat(flatRateUah) * 100);
    if (isNaN(kopiyky) || kopiyky < 0) {
      setError("Невірна сума доставки");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/merchant/shipping", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "nova_poshta",
          isEnabled: true,
          config: { flatRateKopiyky: kopiyky },
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    setError(null);
    try {
      const res = await fetch("/api/merchant/shipping/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      setSyncResult(
        `Синхронізовано: ${data.cities ?? 0} міст (перевірте логи для відділень)`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка синхронізації");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="mt-4 space-y-6">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="flatRate">Фіксована вартість доставки (грн)</Label>
          <Input
            id="flatRate"
            type="number"
            min="0"
            step="1"
            value={flatRateUah}
            onChange={(e) => setFlatRateUah(e.target.value)}
            required
          />
        </div>
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {success && (
          <Alert>
            <CheckCircle2 className="size-4" />
            <AlertDescription>Тариф доставки збережено</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={loading}>
          {loading && <Loader2 className="size-4 animate-spin" />}
          Зберегти тариф
        </Button>
      </form>

      <div className="border-t pt-4">
        <p className="mb-3 text-sm text-muted-foreground">
          Синхронізуйте довідник міст і відділень Нової Пошти. Потрібен{" "}
          <code className="rounded bg-muted px-1">NOVA_POSHTA_API_KEY</code> в env.
        </p>
        <Button type="button" variant="outline" onClick={handleSync} disabled={syncing}>
          {syncing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          Синхронізувати довідник НП
        </Button>
        {syncResult && (
          <p className="mt-2 text-sm text-muted-foreground">{syncResult}</p>
        )}
      </div>
    </div>
  );
}
