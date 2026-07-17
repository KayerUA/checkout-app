import { getEnv } from "@/lib/env";

export type DiloshopJob = {
  id: number;
  topic: string;
  status: string;
  attempts: number;
  last_error?: string | null;
  created_at: number;
  next_run_at: number;
};

export type DiloshopOrderState = {
  shopify_order_id: string;
  mapping?: Record<string, unknown> | null;
  np_shipment?: Record<string, unknown> | null;
  jobs: DiloshopJob[];
  sync_log: Array<Record<string, unknown>>;
  cash_in?: Array<Record<string, unknown>>;
  sale_returns?: Array<Record<string, unknown>>;
};

export type DiloshopIssues = {
  period_hours: number;
  queue: Record<string, number>;
  jobs: DiloshopJob[];
  sync_issues: Array<Record<string, unknown>>;
  np_issues: Array<Record<string, unknown> | null>;
};

function config() {
  const env = getEnv();
  const baseUrl = env.DILOSHOP_API_URL?.replace(/\/$/, "");
  const apiKey = env.DILOSHOP_BOT_API_KEY || env.DILOSHOP_API_KEY;
  if (!baseUrl || !apiKey) return null;
  return { baseUrl, apiKey };
}

async function request<T>(path: string, init?: RequestInit): Promise<T | null> {
  const current = config();
  if (!current) return null;
  const response = await fetch(`${current.baseUrl}/internal/bot${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${current.apiKey}`,
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const payload = (await response.json().catch(() => null)) as
    | (T & { detail?: string })
    | null;
  if (!response.ok) {
    throw new Error(payload?.detail || `Diloshop bot API failed with ${response.status}`);
  }
  return payload;
}

export function getDiloshopHealth() {
  return request<{
    ok: boolean;
    service: string;
    timestamp: number;
    queue: Record<string, number>;
    order_mappings: number;
    recent_issues: number;
  }>("/health");
}

export function getDiloshopIssues(hours = 24, limit = 20) {
  return request<DiloshopIssues>(`/issues?hours=${hours}&limit=${limit}`);
}

export function getDiloshopOrder(shopifyOrderId: string) {
  return request<DiloshopOrderState>(`/order/${encodeURIComponent(shopifyOrderId)}`);
}

export function getDiloshopSku(sku: string) {
  return request<{
    sku: string;
    mapping?: Record<string, unknown> | null;
    sync_log: Array<Record<string, unknown>>;
  }>(`/sku/${encodeURIComponent(sku)}`);
}

export function getDiloshopMappingGaps() {
  return request<{
    mapping: Record<string, number>;
    distinct: Record<string, number>;
  }>("/mapping-gaps");
}

export function runDiloshopOrderAction(
  action: "retry-dilovod" | "retry-np" | "refresh-np",
  shopifyOrderId: string
) {
  return request<Record<string, unknown>>(`/actions/${action}`, {
    method: "POST",
    body: JSON.stringify({ shopify_order_id: shopifyOrderId }),
  });
}
