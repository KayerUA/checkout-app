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
          "group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active
            ? "bg-foreground text-background shadow-[0_14px_30px_rgba(20,20,20,0.16)]"
            : "text-muted-foreground hover:bg-white/70 hover:text-foreground hover:shadow-sm",
          compact && "shrink-0"
        )}
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors",
            active ? "bg-white/12" : "bg-secondary/70 group-hover:bg-white"
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        {item.label}
      </Link>
    );
  };

  return (
    <>
      <aside className="hidden w-72 shrink-0 flex-col border-r bg-white/58 shadow-[18px_0_60px_rgba(28,20,16,0.05)] backdrop-blur-2xl lg:flex">
        <div className="border-b border-white/70 p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            KAYER Checkout
          </p>
          <h1 className="mt-1 text-lg font-semibold tracking-[-0.02em]">Merchant Admin</h1>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Payments, shipping, invoices and operations in one place.
          </p>
          <div className="mt-4 rounded-2xl border bg-white/64 p-3 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">Production</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-200">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Live
              </span>
            </div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1.5 p-4">
          {navItems.map((item) => renderLink(item))}
        </nav>
      </aside>

      <div className="sticky top-0 z-40 border-b bg-background/78 backdrop-blur-2xl lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              KAYER
            </p>
            <p className="text-sm font-semibold">Checkout Admin</p>
          </div>
          <span className="flex size-10 items-center justify-center rounded-2xl bg-white/70 ring-1 ring-black/[0.05]">
            <Menu className="size-5 text-muted-foreground" aria-hidden="true" />
          </span>
        </div>
        <nav className="flex gap-2 overflow-x-auto px-4 pb-3">
          {navItems.map((item) => renderLink(item, true))}
        </nav>
      </div>
    </>
  );
}
