import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto/encryption";
import { buildOfflineSession } from "@/lib/shopify/client";
import { getEnv } from "@/lib/env";
import type { Session } from "@shopify/shopify-api";

export async function getMerchantShopifySession(
  merchantId: string
): Promise<Session | null> {
  const record = await prisma.shopifySession.findUnique({
    where: { merchantId },
    include: { merchant: true },
  });
  if (!record) {
    const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
    const env = getEnv();
    if (
      merchant?.shopDomain &&
      env.SHOPIFY_SHOP_DOMAIN &&
      merchant.shopDomain === env.SHOPIFY_SHOP_DOMAIN &&
      env.SHOPIFY_ADMIN_ACCESS_TOKEN
    ) {
      return buildOfflineSession(merchant.shopDomain, env.SHOPIFY_ADMIN_ACCESS_TOKEN);
    }
    return null;
  }
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
