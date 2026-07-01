import { NextRequest } from "next/server";
import { handleCheckoutAbRouter } from "@/lib/checkout-ab/router-handler";

/** Direct router URL for smoke tests / non-proxy access */
export async function GET(request: NextRequest) {
  return handleCheckoutAbRouter(request);
}
