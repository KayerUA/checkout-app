export const NOVA_POSHTA_POSTOMAT_MAX_COST_CENTS = 2_900_000;

// Explicit merchant-approved declared-value exception. The identifier is only
// stored on a checkout session after a signed Shopify storefront identity check.
const POSTOMAT_DECLARED_VALUE_OVERRIDE_CUSTOMER_GIDS = new Set([
  "gid://shopify/Customer/24109539885380",
]);

export function canUseNovaPoshtaPostomat(input: {
  totalAmountCents: number;
  shopifyCustomerGid?: string | null;
}) {
  return (
    input.totalAmountCents <= NOVA_POSHTA_POSTOMAT_MAX_COST_CENTS ||
    POSTOMAT_DECLARED_VALUE_OVERRIDE_CUSTOMER_GIDS.has(input.shopifyCustomerGid ?? "")
  );
}

export function novaPoshtaPostomatLimitMessage() {
  return "Поштомати доступні для замовлень до 29 000 грн. Оберіть відділення Нової Пошти.";
}
