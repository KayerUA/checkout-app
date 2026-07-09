import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { BRAND } from "@/components/checkout/checkout-header";
import { Mail } from "lucide-react";

export function CheckoutFooter() {
  return (
    <footer className="mt-auto border-t bg-card/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-6 sm:flex-row sm:px-6">
        <p className="text-xs text-muted-foreground">
          © {new Date().getFullYear()} {BRAND.name}. Всі права захищені.
        </p>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <a
            href="mailto:office@kayer.ua"
            className="inline-flex items-center gap-1.5 hover:text-foreground"
          >
            <Mail className="size-3.5" />
            office@kayer.ua
          </a>
          <Separator orientation="vertical" className="h-4" />
          <Link href={BRAND.siteUrl} className="hover:text-foreground" target="_blank" rel="noreferrer">
            В магазин
          </Link>
        </div>
      </div>
    </footer>
  );
}
