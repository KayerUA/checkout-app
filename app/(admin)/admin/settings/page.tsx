import { prisma } from "@/lib/db";
import { requireMerchantSession } from "@/lib/session";
import { ThemeConfigForm } from "@/components/admin/theme-config-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { redirect } from "next/navigation";
import { Settings } from "lucide-react";

export default async function SettingsPage() {
  let session;
  try {
    session = await requireMerchantSession();
  } catch {
    redirect("/admin");
  }

  const merchant = await prisma.merchant.findUnique({
    where: { id: session.merchantId },
  });

  const auditLogs = await prisma.auditLog.findMany({
    where: { merchantId: session.merchantId },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Store identity, checkout theme and recent admin activity."
      />
      <Card className="bg-card/95 shadow-sm shadow-black/5">
        <CardHeader>
          <CardTitle>Store</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="text-zinc-500">Domain:</span> {merchant?.shopDomain}
          </p>
          <p>
            <span className="text-zinc-500">Plan:</span> {merchant?.plan}
          </p>
          <p>
            <span className="text-zinc-500">Paid orders:</span>{" "}
            {merchant?.paidOrdersCount}
          </p>
        </CardContent>
      </Card>
      <Card className="bg-card/95 shadow-sm shadow-black/5">
        <CardHeader>
          <CardTitle>Тема checkout (KAYER)</CardTitle>
          <CardDescription>Логотип і текст кнопки на сторінці оформлення</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeConfigForm />
        </CardContent>
      </Card>
      <Card className="bg-card/95 shadow-sm shadow-black/5">
        <CardHeader>
          <CardTitle>Audit Log</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {auditLogs.map((log) => (
              <div key={log.id} className="border-b border-zinc-100 py-2">
                <span className="font-medium">{log.action}</span>
                <span className="text-zinc-500"> — {log.createdAt.toISOString()}</span>
              </div>
            ))}
            {auditLogs.length === 0 && (
              <EmptyState title="No audit events yet" description="Admin changes will be listed here after settings are updated." icon={<Settings className="size-4" />} />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
