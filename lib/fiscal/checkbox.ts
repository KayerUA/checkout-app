import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/db";
import { logWithCorrelation } from "@/lib/logger";

type CheckboxAuth = { access_token: string };

async function checkboxFetch<T>(
  path: string,
  options: RequestInit & { token?: string } = {}
): Promise<T> {
  const base = getEnv().CHECKBOX_API_URL;
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Checkbox API error: ${text}`);
  }
  return res.json() as Promise<T>;
}

export async function authCashier(licenseKey: string, cashierPin: string) {
  const data = await checkboxFetch<CheckboxAuth>("/cashier/signinPinCode", {
    method: "POST",
    body: JSON.stringify({ license_key: licenseKey, pin_code: cashierPin }),
  });
  return data.access_token;
}

export async function ensureOpenedShift(token: string) {
  const shift = await checkboxFetch<{ id: string; status: string }>("/shifts", {
    method: "POST",
    token,
    body: JSON.stringify({}),
  });
  if (shift.status !== "OPENED") {
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const status = await checkboxFetch<{ status: string }>(`/shifts/${shift.id}`, { token });
      if (status.status === "OPENED") break;
    }
  }
  return shift;
}

export async function createSaleReceipt(
  token: string,
  payload: Record<string, unknown>
) {
  return checkboxFetch<{ id: string }>("/receipts/sell", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export async function createPrepaymentReceipt(
  token: string,
  payload: Record<string, unknown>
) {
  return checkboxFetch<{ id: string; pre_payment_relation_id?: string }>(
    "/prepayment-receipts",
    { method: "POST", token, body: JSON.stringify(payload) }
  );
}

export async function waitReceiptDone(token: string, receiptId: string) {
  for (let i = 0; i < 30; i++) {
    const receipt = await checkboxFetch<{
      id: string;
      status: string;
      fiscal_code?: string;
      tax_url?: string;
    }>(`/receipts/${receiptId}`, { token });
    if (receipt.status === "DONE") return receipt;
    if (receipt.status === "ERROR") throw new Error("Fiscal receipt failed");
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("Fiscal receipt timeout");
}

export async function fiscalizeOrder(orderLinkId: string) {
  const orderLink = await prisma.orderLink.findUnique({
    where: { id: orderLinkId },
    include: {
      checkoutSession: { include: { lines: true, merchant: { include: { fiscalConfig: true } } } },
      fiscalReceipt: true,
    },
  });

  if (!orderLink || orderLink.fiscalReceipt?.status === "DONE") return orderLink?.fiscalReceipt;
  const fiscalConfig = orderLink.checkoutSession.merchant.fiscalConfig;
  if (!fiscalConfig?.isEnabled || !fiscalConfig.licenseKey || !fiscalConfig.cashierPin) {
    return null;
  }

  const receipt = await prisma.fiscalReceipt.upsert({
    where: { orderLinkId },
    create: { orderLinkId, status: "PROCESSING" },
    update: { status: "PROCESSING" },
  });

  try {
    const token = await authCashier(fiscalConfig.licenseKey, fiscalConfig.cashierPin);
    await ensureOpenedShift(token);

    const session = orderLink.checkoutSession;
    const payload = {
      goods: session.lines.map((line) => ({
        good: {
          code: line.sku ?? line.variantGid,
          name: line.title,
          price: line.unitPrice,
        },
        quantity: line.quantity * 1000,
        is_return: false,
      })),
      payments: [{ type: "CASHLESS", value: session.totalAmount }],
    };

    const created = await createSaleReceipt(token, payload);
    const done = await waitReceiptDone(token, created.id);

    return prisma.fiscalReceipt.update({
      where: { id: receipt.id },
      data: {
        status: "DONE",
        receiptId: done.id,
        fiscalNumber: done.fiscal_code,
        receiptUrl: done.tax_url,
        payload: done as object,
      },
    });
  } catch (error) {
    await prisma.fiscalReceipt.update({
      where: { id: receipt.id },
      data: { status: "FAILED", payload: { error: String(error) } },
    });
    logWithCorrelation("error", "Fiscalization failed", {
      fiscalReceiptId: receipt.id,
    }, { error: String(error) });
    throw error;
  }
}
