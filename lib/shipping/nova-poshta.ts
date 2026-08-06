import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/db";

const NP_API = "https://api.novaposhta.ua/v2.0/json/";

type NovaPoshtaConfig = {
  apiKey?: string;
  flatRateKopiyky?: number;
};

async function novaPoshtaRequest<T>(
  apiKey: string,
  modelName: string,
  calledMethod: string,
  methodProperties: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(NP_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey,
      modelName,
      calledMethod,
      methodProperties,
    }),
  });
  const data = await res.json();
  if (!data.success) {
    throw new Error(data.errors?.join(", ") ?? "Nova Poshta API error");
  }
  return data.data as T;
}

export type BranchSearchInput = {
  cityRef: string;
  query?: string;
  includePostomats?: boolean;
  limit?: number;
};

export type BranchSearchResult = {
  ref: string;
  number: string;
  shortAddress: string;
  type: "branch" | "locker" | "courier";
  cityRef: string;
  cityName: string;
  postalCode?: string;
  weightLimitKg?: number;
  codAllowed?: boolean;
};

type NovaPoshtaWarehouse = {
  Ref: string;
  Number: string;
  ShortAddress: string;
  CityRef: string;
  CityDescription: string;
  PostalCodeUA?: string;
  TypeOfWarehouseRef?: string;
  TypeOfWarehouse?: string;
  CategoryOfWarehouse?: string;
};

const NP_POSTOMAT_TYPE_OF_WAREHOUSE_REF = "9a68df70-0267-42a8-bb5c-37f427e36ee4";

export function novaPoshtaWarehouseType(warehouse: Pick<
  NovaPoshtaWarehouse,
  "TypeOfWarehouseRef" | "TypeOfWarehouse" | "CategoryOfWarehouse" | "ShortAddress"
>): BranchSearchResult["type"] {
  const values = [
    warehouse.TypeOfWarehouseRef,
    warehouse.TypeOfWarehouse,
    warehouse.CategoryOfWarehouse,
    warehouse.ShortAddress,
  ]
    .filter(Boolean)
    .join(" ");
  if (
    warehouse.TypeOfWarehouseRef === NP_POSTOMAT_TYPE_OF_WAREHOUSE_REF ||
    /поштомат|postomat/i.test(values)
  ) {
    return "locker";
  }
  return "branch";
}

export async function getConfiguredNovaPoshtaApiKey(merchantId?: string | null) {
  const env = getEnv();
  const where = merchantId
    ? { merchantId_provider: { merchantId, provider: "nova_poshta" } }
    : env.SHOPIFY_SHOP_DOMAIN
      ? {
          merchantId_provider: {
            merchantId: (
              await prisma.merchant.findUnique({
                where: { shopDomain: env.SHOPIFY_SHOP_DOMAIN },
                select: { id: true },
              })
            )?.id ?? "",
            provider: "nova_poshta",
          },
        }
      : null;

  if (where) {
    const config = await prisma.shippingProviderConfig.findUnique({ where });
    const apiKey = (config?.config as NovaPoshtaConfig | null)?.apiKey;
    if (config?.isEnabled && apiKey) return apiKey;
  }

  return env.NOVA_POSHTA_API_KEY ?? "";
}

export async function searchCities(query: string, apiKey?: string) {
  const key = apiKey ?? await getConfiguredNovaPoshtaApiKey();
  if (!key) {
    return prisma.novaPoshtaCity.findMany({
      where: { name: { contains: query, mode: "insensitive" } },
      take: 20,
    });
  }

  const cities = await novaPoshtaRequest<Array<{ Ref: string; Description: string; AreaDescription: string }>>(
    key,
    "Address",
    "searchSettlements",
    { CityName: query, Limit: "20" }
  );

  return cities.flatMap((c) =>
    (c as unknown as { Addresses: Array<{ DeliveryCity: string; MainDescription: string; Area: string }> }).Addresses?.map(
      (a) => ({
        ref: a.DeliveryCity,
        name: a.MainDescription,
        area: a.Area,
      })
    ) ?? []
  );
}

export async function searchBranches(input: BranchSearchInput, apiKey?: string) {
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 100);
  const local = await prisma.novaPoshtaBranch.findMany({
    where: {
      cityRef: input.cityRef,
      ...(input.query
        ? {
            OR: [
              { number: { contains: input.query } },
              { shortAddress: { contains: input.query, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    take: limit,
  });

  if (local.length > 0) {
    const key = apiKey ?? (await getConfiguredNovaPoshtaApiKey());
    let postalByRef: Record<string, string> = {};
    if (key) {
      try {
        const warehouses = await novaPoshtaRequest<
          Array<{ Ref: string; PostalCodeUA?: string }>
        >(key, "Address", "getWarehouses", {
          CityRef: input.cityRef,
          FindByString: input.query ?? "",
          Limit: String(limit),
        });
        postalByRef = Object.fromEntries(
          warehouses
            .map((w) => [w.Ref, (w.PostalCodeUA ?? "").trim()] as const)
            .filter(([, zip]) => zip)
        );
      } catch {
        postalByRef = {};
      }
    }
    return local
      .filter((b) => input.includePostomats !== false || b.type !== "locker")
      .map((b) => ({
      ref: b.ref,
      number: b.number,
      shortAddress: b.shortAddress,
      type: b.type as BranchSearchResult["type"],
      cityRef: b.cityRef,
      cityName: b.cityName ?? "",
      postalCode: postalByRef[b.ref],
      weightLimitKg: b.weightLimit ?? undefined,
      codAllowed: b.codAllowed,
      }));
  }

  const key = apiKey ?? await getConfiguredNovaPoshtaApiKey();
  if (!key) return [];

  const warehouses = await novaPoshtaRequest<Array<NovaPoshtaWarehouse>>(key, "Address", "getWarehouses", {
    CityRef: input.cityRef,
    FindByString: input.query ?? "",
    Limit: String(limit),
  });

  return warehouses
    .filter((w) => input.includePostomats !== false || novaPoshtaWarehouseType(w) !== "locker")
    .map((w) => ({
    ref: w.Ref,
    number: w.Number,
    shortAddress: w.ShortAddress,
    type: novaPoshtaWarehouseType(w),
    cityRef: w.CityRef,
    cityName: w.CityDescription,
    postalCode: (w.PostalCodeUA ?? "").trim() || undefined,
    codAllowed: true,
    }));
}

export async function resolveNovaPoshtaBranchType(input: {
  merchantId: string;
  branchRef: string;
}): Promise<BranchSearchResult["type"] | null> {
  const branchRef = input.branchRef.trim();
  if (!branchRef) return null;

  const apiKey = await getConfiguredNovaPoshtaApiKey(input.merchantId);
  if (apiKey) {
    try {
      const warehouses = await novaPoshtaRequest<Array<NovaPoshtaWarehouse>>(
        apiKey,
        "Address",
        "getWarehouses",
        { Ref: branchRef, Page: "1" }
      );
      const exact = warehouses.find((warehouse) => warehouse.Ref === branchRef);
      if (exact) return novaPoshtaWarehouseType(exact);
    } catch {
      // The synchronized dictionary below is an acceptable fallback during an NP API outage.
    }
  }

  const local = await prisma.novaPoshtaBranch.findUnique({ where: { ref: branchRef } });
  if (!local) return null;
  return local.type === "locker" ? "locker" : "branch";
}

export async function syncNovaPoshtaDictionary(apiKey?: string) {
  const key = apiKey ?? await getConfiguredNovaPoshtaApiKey();
  if (!key) {
    return { cities: 0, branches: 0, skipped: true };
  }

  const cities = await novaPoshtaRequest<
    Array<{ Ref: string; Description: string; DescriptionRu: string; AreaDescription: string }>
  >(key, "Address", "getCities", { Limit: "500", Page: "1" });

  for (const city of cities) {
    await prisma.novaPoshtaCity.upsert({
      where: { ref: city.Ref },
      create: {
        ref: city.Ref,
        name: city.Description,
        nameRu: city.DescriptionRu,
        area: city.AreaDescription,
      },
      update: {
        name: city.Description,
        nameRu: city.DescriptionRu,
        area: city.AreaDescription,
      },
    });

    // Branches are fetched live by selected city in checkout. Syncing every
    // branch for every city is too slow for a serverless admin action.
  }

  return { cities: cities.length, branches: 0, skipped: false };
}

export async function getShippingQuote(merchantId: string): Promise<number> {
  const config = await prisma.shippingProviderConfig.findUnique({
    where: { merchantId_provider: { merchantId, provider: "nova_poshta" } },
  });
  const flatRate = (config?.config as { flatRateKopiyky?: number })?.flatRateKopiyky ?? 9000;
  return flatRate;
}
