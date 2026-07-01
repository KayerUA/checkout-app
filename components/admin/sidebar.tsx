"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CreditCard,
  FlaskConical,
  LayoutDashboard,
  Package,
  Receipt,
  Landmark,
  Settings,
  ShoppingCart,
  Truck,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/payments", label: "Payments", icon: CreditCard },
  { href: "/admin/shipping", label: "Shipping", icon: Truck },
  { href: "/admin/fiscal", label: "Fiscal", icon: Receipt },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/ab-test", label: "A/B Checkout", icon: FlaskConical },
  { href: "/admin/abandoned", label: "Abandoned", icon: ShoppingCart },
  { href: "/admin/orders", label: "Orders", icon: Package },
  { href: "/admin/b2b-orders", label: "B2B Orders", icon: Landmark },
  { href: "/admin/ops", label: "Operations", icon: Wrench },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-64 flex-col border-r border-zinc-200 bg-zinc-50">
      <div className="border-b border-zinc-200 p-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          UA Checkout
        </p>
        <h1 className="text-lg font-bold text-zinc-900">Merchant Admin</h1>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-4">
        {navItems.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== "/admin" && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
