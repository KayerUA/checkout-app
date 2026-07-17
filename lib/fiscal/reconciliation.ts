import { prisma } from "@/lib/db";
import { fiscalizeOrder } from "@/lib/fiscal/checkbox";
import { notifyExternalOpsAlert } from "@/lib/telegram/ops-alerts";

export async function reconcileFiscalReceipts(take = 20) {
  const orderLinks = await prisma.orderLink.findMany({
    where: {
      checkoutSession: {
        merchant: { fiscalConfig: { is: { isEnabled: true } } },
      },
      OR: [
        { fiscalReceipt: null },
        { fiscalReceipt: { is: { status: { in: ["PENDING", "FAILED"] } } } },
      ],
    },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(take, 1), 50),
  });

  const results = [];
  for (const orderLink of orderLinks) {
    try {
      const receipt = await fiscalizeOrder(orderLink.id);
      results.push({ orderLinkId: orderLink.id, status: receipt?.status ?? "skipped" });
    } catch (error) {
      const shopifyOrderId = orderLink.shopifyOrderGid?.match(/\/Order\/(\d+)$/)?.[1];
      await notifyExternalOpsAlert({
        source: "checkout",
        eventType: `fiscal_failed_${orderLink.id.slice(-8)}`,
        severity: "error",
        shopifyOrderId,
        message: error instanceof Error ? error.message : String(error),
      }).catch(() => {});
      results.push({
        orderLinkId: orderLink.id,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { checked: orderLinks.length, results };
}
