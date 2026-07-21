import { normalizeUaPhone } from "@/lib/checkout/phone";
import { normalizeUaPersonName } from "@/lib/checkout/ua-person-name";
import type { NovaPoshtaShippingPayload } from "@/lib/shipping/shopify-np-note-attributes";

type FulfillmentInput = {
  buyerEmail?: string | null;
  buyerPhone?: string | null;
  buyerFirstName?: string | null;
  buyerLastName?: string | null;
  shippingProvider?: string | null;
  shippingMethodCode?: string | null;
  shippingPayload?: unknown;
};

const UA_NAME = /^[\p{Script=Cyrillic}][\p{Script=Cyrillic}'’ -]{1,79}$/u;

function hasValidName(value: string | null | undefined) {
  const normalized = normalizeUaPersonName(value)?.trim() ?? "";
  return UA_NAME.test(normalized);
}

/** Returns operator-facing prerequisites required by Shopify and Nova Poshta. */
export function checkoutFulfillmentIssues(input: FulfillmentInput) {
  const issues: string[] = [];
  if (!input.buyerEmail?.trim() || !/^\S+@\S+\.\S+$/.test(input.buyerEmail.trim())) {
    issues.push("коректний email");
  }
  if (!normalizeUaPhone(input.buyerPhone)) issues.push("український номер +380XXXXXXXXX");
  if (!hasValidName(input.buyerFirstName)) issues.push("ім’я отримувача кирилицею");
  if (!hasValidName(input.buyerLastName)) issues.push("прізвище отримувача кирилицею");

  if (input.shippingProvider !== "nova_poshta") {
    issues.push("служба доставки Нова Пошта");
    return issues;
  }
  if (!['nova_poshta_branch', 'nova_poshta_locker'].includes(input.shippingMethodCode ?? "")) {
    issues.push("тип доставки Нова Пошта");
  }

  const shipping = (input.shippingPayload ?? {}) as NovaPoshtaShippingPayload;
  if (!shipping.cityRef?.trim() || !shipping.cityName?.trim()) issues.push("місто Нова Пошта");
  if (!shipping.branchRef?.trim() || !shipping.branchName?.trim()) issues.push("відділення або поштомат Нова Пошта");
  if (!/^\d{5}$/.test(shipping.postalCode ?? "")) issues.push("п’ятизначний індекс відділення Нова Пошта");
  return issues;
}

export class CheckoutFulfillmentValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Перевірте дані отримувача: ${issues.join(", ")}`);
    this.name = "CheckoutFulfillmentValidationError";
  }
}

export function assertCheckoutReadyForFulfillment(input: FulfillmentInput) {
  const issues = checkoutFulfillmentIssues(input);
  if (issues.length) throw new CheckoutFulfillmentValidationError(issues);
}
