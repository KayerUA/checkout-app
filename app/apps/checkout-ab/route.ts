import { NextRequest } from "next/server";
import { handleCheckoutAbRouter } from "@/lib/checkout-ab/router-handler";

/** Shopify App Proxy entry: kayer.ua/apps/checkout-ab */
export async function GET(request: NextRequest) {
  return handleCheckoutAbRouter(request);
}
