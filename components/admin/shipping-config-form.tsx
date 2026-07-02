"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Loader2, RefreshCw } from "lucide-react";

export type ShippingConfigInitial = {
  isEnabled: boolean;
  flatRateKopiyky: number;
  hasApiKey: boolean;
};

export function ShippingConfigForm({ initial }: { initial: ShippingConfigInitial }) {
  const [flatRateUah, setFlatRateUah] = useState(String(initial.flatRateKopiyky / 100));
  const [apiKey, setApiKey] = useState("");
  const [isEnabled, setIsEnabled] = useState(initial.isEnabled);
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
      const config: Record<string, string | number> = { flatRateKopiyky: kopiyky };
      if (apiKey.trim()) config.apiKey = apiKey.trim();

      const res = await fetch("/api/merchant/shipping", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "nova_poshta",
          isEnabled,
          config,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      setSuccess(true);
      setApiKey("");
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
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isEnabled ? "default" : "secondary"}>
            {isEnabled ? "Нова Пошта увімкнена" : "Нова Пошта вимкнена"}
          </Badge>
          {initial.hasApiKey && <Badge variant="outline">API key збережено</Badge>}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={isEnabled}
            onChange={(e) => setIsEnabled(e.target.checked)}
          />
          Увімкнути доставку Новою Поштою
        </label>

        <div className="space-y-2">
          <Label htmlFor="apiKey">Нова Пошта API Key</Label>
          <Input
            id="apiKey"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={initial.hasApiKey ? "Залиште порожнім, щоб не змінювати" : "API key"}
            required={!initial.hasApiKey && isEnabled}
          />
          <p className="text-xs text-muted-foreground">
            API key не показується назад після збереження. Якщо поле порожнє,
            використовується вже збережений ключ.
          </p>
        </div>

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
            <AlertDescription>Налаштування Нової Пошти збережено</AlertDescription>
          </Alert>
        )}
        <Button type="submit" disabled={loading}>
          {loading && <Loader2 className="size-4 animate-spin" />}
          {isEnabled ? "Зберегти та увімкнути Нову Пошту" : "Зберегти та вимкнути Нову Пошту"}
        </Button>
      </form>

      <div className="border-t pt-4">
        <p className="mb-3 text-sm text-muted-foreground">
          Синхронізуйте довідник міст і відділень Нової Пошти після збереження API key.
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
