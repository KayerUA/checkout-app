import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { log } from "@/lib/logger";
import { UnauthorizedError } from "@/lib/session";
import { PaymentIntegrityError } from "@/lib/payments/integrity";
import { CheckoutDiscountError } from "@/lib/checkout/discount-code";
import { CheckoutFulfillmentValidationError } from "@/lib/checkout/fulfillment-validation";

export function apiErrorResponse(
  error: unknown,
  fallbackMessage: string,
  options?: { validationMessage?: string }
) {
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: options?.validationMessage ?? "Invalid request" },
      { status: 400 }
    );
  }

  if (error instanceof PaymentIntegrityError) {
    return NextResponse.json({ error: "Payment verification failed" }, { status: 409 });
  }

  if (error instanceof CheckoutDiscountError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (error instanceof CheckoutFulfillmentValidationError) {
    return NextResponse.json({ error: error.message, issues: error.issues }, { status: 400 });
  }

  if (error instanceof Error && error.message === "Session not found") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  log("error", fallbackMessage, {
    error: error instanceof Error ? error.message : String(error),
  });
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}
