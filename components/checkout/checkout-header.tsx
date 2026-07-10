import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Headphones, Mail, Phone, ShieldCheck } from "lucide-react";

const BRAND = {
  name: "KAYER",
  siteUrl: "https://kayer.ua",
  tagline: "Професійні матеріали для нігтів",
  supportEmail: "office@kayer.ua",
  supportPhone: "+38 (050) 777 66 56",
  supportPhoneHref: "tel:+380507776656",
};

type Props = {
  logoUrl?: string;
};

export function CheckoutHeader({ logoUrl }: Props) {
  const resolvedLogoUrl = logoUrl || "/kayer-logo.svg";

  return (
    <header className="relative z-[9998] overflow-visible border-b bg-card/72 shadow-sm ring-1 ring-white/60 backdrop-blur-2xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        <Link href={BRAND.siteUrl} className="flex items-center gap-3" target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resolvedLogoUrl} alt={BRAND.name} className="h-7 w-auto object-contain sm:h-8" />
        </Link>
        <div className="flex items-center gap-2">
          <details className="group relative hidden sm:block">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-full bg-white/70 px-3 py-1 text-xs font-normal text-foreground shadow-sm ring-1 ring-black/[0.04] transition-colors hover:bg-white [&::-webkit-details-marker]:hidden">
              <Headphones className="size-3.5" />
              Підтримка KAYER
            </summary>
            <div className="fixed right-6 top-16 z-[9999] w-80 rounded-3xl border bg-white p-4 text-sm shadow-[0_24px_70px_rgba(28,20,16,0.16)] ring-1 ring-black/[0.04]">
              <p className="font-semibold">Потрібна допомога?</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Напишіть або зателефонуйте, якщо є питання щодо замовлення, оплати чи доставки.
              </p>
              <div className="mt-3 space-y-2">
                <a className="flex items-center gap-2 rounded-2xl bg-secondary/60 px-3 py-2 font-medium hover:bg-secondary" href={BRAND.supportPhoneHref}>
                  <Phone className="size-4" />
                  {BRAND.supportPhone}
                </a>
                <a className="flex items-center gap-2 rounded-2xl bg-secondary/60 px-3 py-2 font-medium hover:bg-secondary" href={`mailto:${BRAND.supportEmail}`}>
                  <Mail className="size-4" />
                  {BRAND.supportEmail}
                </a>
              </div>
            </div>
          </details>
          <Badge variant="secondary" className="rounded-full bg-white/70 px-3 py-1 gap-1.5 font-normal ring-1 ring-black/[0.04]">
            <ShieldCheck className="size-3.5" />
            <span className="hidden sm:inline">Безпечна оплата</span>
            <span className="sm:hidden">Secure</span>
          </Badge>
        </div>
      </div>
      <Separator />
    </header>
  );
}

export { BRAND };
