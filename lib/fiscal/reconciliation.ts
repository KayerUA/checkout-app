import { prisma } from "@/lib/db";
import { fiscalizeOrder } from "@/lib/fiscal/checkbox";

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
      results.push({
        orderLinkId: orderLink.id,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { checked: orderLinks.length, results };
}
