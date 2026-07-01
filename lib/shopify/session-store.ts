import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto/encryption";
import { buildOfflineSession } from "@/lib/shopify/client";
import type { Session } from "@shopify/shopify-api";

export async function getMerchantShopifySession(
  merchantId: string
): Promise<Session | null> {
  const record = await prisma.shopifySession.findUnique({
    where: { merchantId },
    include: { merchant: true },
  });
  if (!record) return null;
  const accessToken = decrypt(record.accessTokenEncrypted);
  return buildOfflineSession(record.merchant.shopDomain, accessToken);
}

export async function saveShopifySession(
  merchantId: string,
  accessToken: string,
  scopes: string
) {
  await prisma.shopifySession.upsert({
    where: { merchantId },
    create: {
      merchantId,
      accessTokenEncrypted: encrypt(accessToken),
      scopes,
    },
    update: {
      accessTokenEncrypted: encrypt(accessToken),
      scopes,
    },
  });
}
