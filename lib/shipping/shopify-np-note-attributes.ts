export type NovaPoshtaShippingPayload = {
  cityRef?: string;
  cityName?: string;
  branchRef?: string;
  branchName?: string;
  branchNumber?: string;
  branchType?: "branch" | "locker" | "courier" | string;
  address?: string;
  postalCode?: string;
};

export type ShopifyNoteAttribute = { name: string; value: string };

function isPostomat(payload: NovaPoshtaShippingPayload, branchName: string) {
  if (payload.branchType === "locker") return true;
  return /поштомат|postomat/i.test(branchName);
}

function warehouseLabel(payload: NovaPoshtaShippingPayload, branchName: string) {
  const number = (payload.branchNumber ?? "").trim();
  if (!number) return branchName;
  const prefix = isPostomat(payload, branchName) ? "Поштомат" : "Відділення";
  return `${prefix}:${number}`;
}

function warehouseDisplayName(payload: NovaPoshtaShippingPayload, branchName: string) {
  const number = (payload.branchNumber ?? "").trim();
  if (!number) return branchName;
  if (isPostomat(payload, branchName)) {
    return `Поштомат "Нова Пошта" №${number}: ${branchName}`;
  }
  return `Відділення №${number}: ${branchName}`;
}

export function buildShopifyNovaPoshtaNoteAttributes(
  payload: NovaPoshtaShippingPayload | null | undefined
): ShopifyNoteAttribute[] {
  const branchRef = (payload?.branchRef ?? "").trim();
  const branchName = (payload?.branchName ?? "").trim();
  const cityRef = (payload?.cityRef ?? "").trim();
  const cityName = (payload?.cityName ?? "").trim();

  if (!branchRef || !branchName) return [];

  const cityLabel = cityName || "Київ";
  const postomat = isPostomat(payload ?? {}, branchName);
  const warehouseName = warehouseLabel(payload ?? {}, branchName);
  const warehouseDisplay = warehouseDisplayName(payload ?? {}, branchName);

  return [
    { name: "Delivery Method", value: "Нова пошта" },
    { name: "City", value: cityLabel },
    { name: "_delivery_type", value: "branch" },
    {
      name: "_delivery_method",
      value: postomat ? "Відділення / Поштомат" : "Відділення / Поштомат",
    },
    { name: "_delivery_city", value: cityLabel },
    { name: "_delivery_city_Ref", value: cityRef },
    { name: "_delivery_warehouse", value: warehouseDisplay },
    ...(payload?.postalCode
      ? [{ name: "_delivery_warehouse_zip", value: String(payload.postalCode) }]
      : []),
    { name: "_delivery_warehouse_name", value: warehouseName },
    { name: "_delivery_warehouse_address", value: branchName },
    { name: "_delivery_warehouse_CityRef", value: cityRef },
    ...(payload?.branchNumber
      ? [{ name: "_delivery_warehouse_Number", value: String(payload.branchNumber) }]
      : []),
    { name: "_delivery_warehouse_Ref", value: branchRef },
    { name: "Nova-post-delivery", value: "Address" },
    { name: "np_branch_ref", value: branchRef },
    { name: "np_branch_name", value: branchName },
    ...(cityRef ? [{ name: "np_city_ref", value: cityRef }] : []),
  ];
}

export function mergeCheckoutNoteAttributes(
  base: ShopifyNoteAttribute[],
  shippingPayload: NovaPoshtaShippingPayload | null | undefined
): ShopifyNoteAttribute[] {
  const npRows = buildShopifyNovaPoshtaNoteAttributes(shippingPayload);
  const npKeys = new Set(npRows.map((row) => row.name));
  const withoutNp = base.filter((row) => !npKeys.has(row.name));
  return [...withoutNp, ...npRows];
}
