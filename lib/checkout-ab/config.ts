import { z } from "zod";

export const AB_VARIANTS = {
  CHEKLY: "chekly_current",
  CUSTOM: "kayer_custom_v1",
} as const;

export type AbVariant = (typeof AB_VARIANTS)[keyof typeof AB_VARIANTS];

const abConfigSchema = z.object({
  CHECKOUT_AB_EXPERIMENT_ID: z.string().default("checkout_router_2026_06"),
  CHEKLY_WEIGHT: z.coerce.number().int().min(0).max(100).default(95),
  CUSTOM_WEIGHT: z.coerce.number().int().min(0).max(100).default(5),
  CUSTOM_CHECKOUT_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  CHEKLY_CHECKOUT_URL: z.string().default("/checkout"),
  KAYER_SHOP_DOMAIN: z.string().default("kayer.myshopify.com"),
  CHECKOUT_AB_VISITOR_COOKIE: z.string().default("kayer_ab_vid"),
});

export type CheckoutAbConfig = z.infer<typeof abConfigSchema>;

let cached: CheckoutAbConfig | null = null;

export function getCheckoutAbConfig(): CheckoutAbConfig {
  if (cached) return cached;
  cached = abConfigSchema.parse({
    CHECKOUT_AB_EXPERIMENT_ID: process.env.CHECKOUT_AB_EXPERIMENT_ID,
    CHEKLY_WEIGHT: process.env.CHEKLY_WEIGHT,
    CUSTOM_WEIGHT: process.env.CUSTOM_WEIGHT,
    CUSTOM_CHECKOUT_ENABLED: process.env.CUSTOM_CHECKOUT_ENABLED,
    CHEKLY_CHECKOUT_URL: process.env.CHEKLY_CHECKOUT_URL,
    KAYER_SHOP_DOMAIN: process.env.KAYER_SHOP_DOMAIN,
    CHECKOUT_AB_VISITOR_COOKIE: process.env.CHECKOUT_AB_VISITOR_COOKIE,
  });
  return cached;
}

export function resolveCheklyUrl(shopOrigin: string, configuredUrl: string): string {
  if (configuredUrl.startsWith("http://") || configuredUrl.startsWith("https://")) {
    return configuredUrl;
  }
  return `${shopOrigin.replace(/\/$/, "")}${configuredUrl.startsWith("/") ? "" : "/"}${configuredUrl}`;
}
