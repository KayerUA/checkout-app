"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CreditCard,
  FlaskConical,
  Landmark,
  LayoutDashboard,
  Menu,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  Truck,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/payments", label: "Payments", icon: CreditCard },
  { href: "/admin/bank", label: "Bank", icon: Landmark },
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

  const renderLink = (item: (typeof navItems)[number], compact = false) => {
    const active =
      pathname === item.href ||
      (item.href !== "/admin" && pathname.startsWith(item.href));
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        className={cn(
          "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active
            ? "bg-primary text-primary-foreground shadow-sm"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          compact && "shrink-0"
        )}
      >
        <Icon className="h-4 w-4" />
        {item.label}
      </Link>
    );
  };

  return (
    <>
      <aside className="hidden w-72 shrink-0 flex-col border-r bg-sidebar/95 lg:flex">
        <div className="border-b p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            KAYER Checkout
          </p>
          <h1 className="mt-1 text-lg font-semibold tracking-tight">Merchant Admin</h1>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Payments, shipping, invoices and operations in one place.
          </p>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-4">
          {navItems.map((item) => renderLink(item))}
        </nav>
      </aside>

      <div className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              KAYER
            </p>
            <p className="text-sm font-semibold">Checkout Admin</p>
          </div>
          <Menu className="size-5 text-muted-foreground" aria-hidden="true" />
        </div>
        <nav className="flex gap-2 overflow-x-auto px-4 pb-3">
          {navItems.map((item) => renderLink(item, true))}
        </nav>
      </div>
    </>
  );
}
