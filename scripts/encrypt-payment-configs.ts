import { prisma } from "@/lib/db";
import {
  encryptPaymentConfig,
  paymentConfigNeedsEncryption,
} from "@/lib/payments/config-secrets";

async function main() {
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

  console.log(JSON.stringify({ checked: configs.length, migrated }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
