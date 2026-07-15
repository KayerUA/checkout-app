import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  encryptPaymentConfig,
  paymentConfigNeedsEncryption,
} from "@/lib/payments/config-secrets";

export const runtime = "nodejs";

function authorized(request: NextRequest) {
  const expected = process.env.PAYMENT_MIGRATION_SECRET ?? "";
  const actual = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configs = await prisma.paymentProviderConfig.findMany();
  let migrated = 0;
  for (const config of configs) {
    const raw = config.config as Record<string, string>;
    if (!paymentConfigNeedsEncryption(raw)) continue;
    await prisma.paymentProviderConfig.update({
      where: { id: config.id },
      data: { config: encryptPaymentConfig(raw) },
    });
    migrated += 1;
  }

  return NextResponse.json({ checked: configs.length, migrated });
}
