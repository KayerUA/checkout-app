import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { assignCheckoutVariant } from "@/lib/checkout-ab/assignment";
import { buildBridgeConfig, renderCheckoutAbBridgePage } from "@/lib/checkout-ab/bridge-html";
import { getCheckoutAbConfig } from "@/lib/checkout-ab/config";
import { logCheckoutAbEvent } from "@/lib/checkout-ab/events";
import {
  getShopFromProxyParams,
  verifyShopifyAppProxy,
} from "@/lib/shopify/app-proxy";

function getOrCreateVisitorId(request: NextRequest, response: NextResponse): string {
  const config = getCheckoutAbConfig();
  const cookieName = config.CHECKOUT_AB_VISITOR_COOKIE;
  const existing = request.cookies.get(cookieName)?.value;
  if (existing) return existing;

  const visitorId = crypto.randomUUID();
  response.cookies.set(cookieName, visitorId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
    path: "/",
  });
  return visitorId;
}

function parseForceCheckout(
  value: string | null
): "chekly" | "custom" | null {
  if (value === "chekly") return "chekly";
  if (value === "custom") return "custom";
  return null;
}

function extractUtm(searchParams: URLSearchParams) {
  const utm: Record<string, string> = {};
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
    const val = searchParams.get(key);
    if (val) utm[key] = val;
  }
  return utm;
}

function resolveShopOrigin(request: NextRequest, searchParams: URLSearchParams): string {
  const shop = getShopFromProxyParams(searchParams);
  if (shop) return `https://${shop}`;
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      /* ignore */
    }
  }
  return "https://kayer.ua";
}

export async function handleCheckoutAbRouter(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  if (searchParams.get("resource") === "pricing-token") {
    const { handleStorefrontPricingToken } = await import(
      "@/lib/checkout/storefront-pricing-token-handler"
    );
    return handleStorefrontPricingToken(request);
  }

  const isProxyRequest = searchParams.has("signature") && searchParams.has("shop");

  if (isProxyRequest && !verifyShopifyAppProxy(searchParams)) {
    return NextResponse.json({ error: "Invalid app proxy signature" }, { status: 401 });
  }

  const htmlResponse = new NextResponse(null, { status: 200 });
  const visitorId = getOrCreateVisitorId(request, htmlResponse);
  const forceCheckout = parseForceCheckout(searchParams.get("force_checkout"));
  const utm = extractUtm(searchParams);

  try {
    const assignment = await assignCheckoutVariant({ visitorId, forceCheckout });

    await logCheckoutAbEvent({
      experimentId: assignment.experimentId,
      visitorId: assignment.visitorId,
      variant: assignment.variant,
      eventName: "checkout_click",
      payload: {
        forced: assignment.forced,
        isNewAssignment: assignment.isNewAssignment,
        utm,
        userAgent: request.headers.get("user-agent"),
        referer: request.headers.get("referer"),
      },
    });

    const shopOrigin = resolveShopOrigin(request, searchParams);
    const bridgeConfig = buildBridgeConfig({
      experimentId: assignment.experimentId,
      visitorId: assignment.visitorId,
      variant: assignment.variant,
      shopOrigin,
    });

    const html = renderCheckoutAbBridgePage(bridgeConfig);
    const response = new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });

    htmlResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie);
    });

    return response;
  } catch (error) {
    const config = getCheckoutAbConfig();
    const shopOrigin = resolveShopOrigin(request, searchParams);
    const { resolveCheklyUrl } = await import("@/lib/checkout-ab/config");
    const fallback = resolveCheklyUrl(shopOrigin, config.CHEKLY_CHECKOUT_URL);

    await logCheckoutAbEvent({
      experimentId: config.CHECKOUT_AB_EXPERIMENT_ID,
      visitorId,
      variant: "chekly_current",
      eventName: "checkout_error",
      payload: {
        message: error instanceof Error ? error.message : "router_failed",
        stage: "router",
      },
    }).catch(() => {});

    const errorResponse = NextResponse.redirect(fallback);
    htmlResponse.cookies.getAll().forEach((cookie) => {
      errorResponse.cookies.set(cookie);
    });
    return errorResponse;
  }
}
