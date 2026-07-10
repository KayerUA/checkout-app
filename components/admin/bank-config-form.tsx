"use client";

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Loader2, PlugZap, RefreshCcw } from "lucide-react";

export type BankConfigInitial = {
  isEnabled: boolean;
  apiUrl: string;
  clientId: string;
  iban: string;
  hasToken: boolean;
};

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { error: text };
  }
}

function summarizeReconciliation(data: Record<string, unknown>) {
  const results = Array.isArray(data.results) ? data.results : [];
  const counts = results.reduce(
    (acc, item) => {
      const status =
        item && typeof item === "object" && "status" in item
          ? String((item as { status?: unknown }).status)
          : "SKIPPED";
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const checked = Number(data.checked ?? results.length);
  const stats =
    data.candidateStats && typeof data.candidateStats === "object"
      ? (data.candidateStats as { merged?: number; prismaOrders?: number; shopifyOrders?: number })
      : null;
  const candidateLine = stats
    ? `Кандидатів на оплату: ${stats.merged ?? 0} (БД ${stats.prismaOrders ?? 0}, Shopify ${stats.shopifyOrders ?? 0})`
    : null;
  const errorDetails = results
    .filter((item) => item && typeof item === "object" && (item as { status?: string }).status === "ERROR")
    .map((item) => {
      const row = item as { transactionId?: string; reason?: string; shopifyOrderId?: string };
      return [row.transactionId, row.shopifyOrderId, row.reason].filter(Boolean).join(": ");
    })
    .filter(Boolean);
  return [
    `Звірку виконано. Перевірено транзакцій: ${Number.isFinite(checked) ? checked : results.length}`,
    candidateLine,
    `MATCHED: ${counts.MATCHED ?? 0}`,
    `SKIPPED: ${counts.SKIPPED ?? 0}`,
    `NEEDS_REVIEW: ${counts.NEEDS_REVIEW ?? 0}`,
    `NEW: ${counts.NEW ?? 0}`,
    `ERROR: ${counts.ERROR ?? 0}`,
    errorDetails.length ? `Помилки: ${errorDetails.join(" · ")}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function BankConfigForm({ initial }: { initial: BankConfigInitial }) {
  const [isEnabled, setIsEnabled] = useState(initial.isEnabled);
  const [apiUrl, setApiUrl] = useState(initial.apiUrl);
  const [clientId, setClientId] = useState(initial.clientId);
  const [iban, setIban] = useState(initial.iban);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [success, setSuccess] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [reconcileResult, setReconcileResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setSuccess(false);
    setError(null);
    setTestResult(null);
    setReconcileResult(null);

    try {
      const config: Record<string, string> = {
        apiUrl,
        clientId,
        iban: iban.replace(/\s/g, ""),
      };
      if (token.trim()) config.token = token.trim();

      const res = await fetch("/api/merchant/bank", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled, config }),
      });
      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(String(data.error ?? "Failed to save bank config"));
      setSuccess(true);
      setToken("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка збереження");
    } finally {
      setLoading(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setError(null);
    setTestResult(null);
    setReconcileResult(null);
    try {
      const res = await fetch("/api/merchant/bank", { method: "POST" });
      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(String(data.error ?? "Privat24 test failed"));
      setTestResult(`З'єднання працює. Отримано транзакцій: ${data.transactions ?? 0}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка перевірки");
    } finally {
      setTesting(false);
    }
  }

  async function runReconciliation() {
    setReconciling(true);
    setError(null);
    setTestResult(null);
    setReconcileResult(null);
    try {
      const res = await fetch("/api/merchant/bank/reconcile?days=7", { method: "POST" });
      const data = await readJsonResponse(res);
      if (!res.ok) throw new Error(String(data.error ?? "Bank reconciliation failed"));
      setReconcileResult(summarizeReconciliation(data));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка звірки");
    } finally {
      setReconciling(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={isEnabled ? "default" : "secondary"}>
          {isEnabled ? "Privat24 увімкнено" : "Privat24 вимкнено"}
        </Badge>
        {initial.hasToken && <Badge variant="outline">Token збережено</Badge>}
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={isEnabled}
          onChange={(event) => setIsEnabled(event.target.checked)}
        />
        Увімкнути автоматичну звірку через Privat24 Business
      </label>

      <div className="space-y-2">
        <Label htmlFor="bankApiUrl">Privat24 API URL</Label>
        <Input id="bankApiUrl" value={apiUrl} onChange={(event) => setApiUrl(event.target.value)} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="bankClientId">ID додатка / User-Agent</Label>
        <Input
          id="bankClientId"
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          placeholder="ID з Privat24 Business"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="bankToken">Token</Label>
        <Input
          id="bankToken"
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={initial.hasToken ? "Залиште порожнім, щоб не змінювати" : "Token з Privat24"}
          required={!initial.hasToken && isEnabled}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="bankIban">IBAN рахунку</Label>
        <Input
          id="bankIban"
          value={iban}
          onChange={(event) => setIban(event.target.value)}
          placeholder="UA273052990000026005035040022"
          required={isEnabled}
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
          <AlertDescription>Privat24 налаштування збережено</AlertDescription>
        </Alert>
      )}
      {testResult && (
        <Alert>
          <PlugZap className="size-4" />
          <AlertDescription>{testResult}</AlertDescription>
        </Alert>
      )}
      {reconcileResult && (
        <Alert>
          <RefreshCcw className="size-4" />
          <AlertDescription>{reconcileResult}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={loading}>
          {loading && <Loader2 className="size-4 animate-spin" />}
          {isEnabled ? "Зберегти та увімкнути Privat24" : "Зберегти та вимкнути Privat24"}
        </Button>
        <Button type="button" variant="outline" disabled={testing} onClick={testConnection}>
          {testing && <Loader2 className="size-4 animate-spin" />}
          Перевірити з&apos;єднання
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={reconciling || !isEnabled}
          onClick={runReconciliation}
        >
          {reconciling ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCcw className="size-4" />
          )}
          Запустити звірку зараз
        </Button>
      </div>
    </form>
  );
}
