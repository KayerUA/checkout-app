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
};

export type BranchSearchResult = {
  ref: string;
  number: string;
  shortAddress: string;
  type: "branch" | "locker" | "courier";
  cityRef: string;
  cityName: string;
  weightLimitKg?: number;
  codAllowed?: boolean;
};

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
    { CityName: query, Limit: 20 }
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
    take: 30,
  });

  if (local.length > 0) {
    return local.map((b) => ({
      ref: b.ref,
      number: b.number,
      shortAddress: b.shortAddress,
      type: b.type as BranchSearchResult["type"],
      cityRef: b.cityRef,
      cityName: b.cityName ?? "",
      weightLimitKg: b.weightLimit ?? undefined,
      codAllowed: b.codAllowed,
    }));
  }

  const key = apiKey ?? await getConfiguredNovaPoshtaApiKey();
  if (!key) return [];

  const warehouses = await novaPoshtaRequest<
    Array<{ Ref: string; Number: string; ShortAddress: string; CityRef: string; CityDescription: string }>
  >(key, "Address", "getWarehouses", {
    CityRef: input.cityRef,
    FindByString: input.query ?? "",
    Limit: 30,
  });

  return warehouses.map((w) => ({
    ref: w.Ref,
    number: w.Number,
    shortAddress: w.ShortAddress,
    type: "branch" as const,
    cityRef: w.CityRef,
    cityName: w.CityDescription,
    codAllowed: true,
  }));
}

export async function syncNovaPoshtaDictionary(apiKey?: string) {
  const key = apiKey ?? await getConfiguredNovaPoshtaApiKey();
  if (!key) {
    return { cities: 0, branches: 0, skipped: true };
  }

  const cities = await novaPoshtaRequest<
    Array<{ Ref: string; Description: string; DescriptionRu: string; AreaDescription: string }>
  >(key, "Address", "getCities", { Limit: 500, Page: 1 });

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

    const warehouses = await novaPoshtaRequest<
      Array<{
        Ref: string;
        Number: string;
        ShortAddress: string;
        CityRef: string;
        CityDescription: string;
        TotalMaxWeightAllowed?: string;
      }>
    >(key, "Address", "getWarehouses", { CityRef: city.Ref, Limit: 200 });

    for (const w of warehouses) {
      await prisma.novaPoshtaBranch.upsert({
        where: { ref: w.Ref },
        create: {
          ref: w.Ref,
          cityRef: w.CityRef,
          number: w.Number,
          shortAddress: w.ShortAddress,
          cityName: w.CityDescription,
          weightLimit: w.TotalMaxWeightAllowed
            ? parseFloat(w.TotalMaxWeightAllowed)
            : null,
        },
        update: {
          number: w.Number,
          shortAddress: w.ShortAddress,
          cityName: w.CityDescription,
        },
      });
    }
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
