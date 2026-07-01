import "@shopify/shopify-api/adapters/node";
import { shopifyApi, ApiVersion, Session } from "@shopify/shopify-api";
import { getEnv } from "@/lib/env";

let shopifyInstance: ReturnType<typeof shopifyApi> | null = null;

export function getShopify() {
  if (shopifyInstance) return shopifyInstance;
  const env = getEnv();
  shopifyInstance = shopifyApi({
    apiKey: env.SHOPIFY_API_KEY,
    apiSecretKey: env.SHOPIFY_API_SECRET,
    scopes: env.SHOPIFY_SCOPES.split(","),
    hostName: new URL(env.APP_URL).host,
    apiVersion: env.SHOPIFY_API_VERSION as ApiVersion,
    isEmbeddedApp: false,
    isCustomStoreApp: false,
  });
  return shopifyInstance;
}

export function buildOfflineSession(shop: string, accessToken: string): Session {
  return new Session({
    id: `offline_${shop}`,
    shop,
    state: "",
    isOnline: false,
    accessToken,
    scope: getEnv().SHOPIFY_SCOPES,
  });
}
