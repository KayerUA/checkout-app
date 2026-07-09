import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Headphones, ShieldCheck } from "lucide-react";

const BRAND = {
  name: "KAYER",
  siteUrl: "https://kayer.ua",
  tagline: "Професійні матеріали для нігтів",
};

type Props = {
  logoUrl?: string;
};

export function CheckoutHeader({ logoUrl }: Props) {
  return (
    <header className="border-b bg-card/72 shadow-sm ring-1 ring-white/60 backdrop-blur-2xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6 sm:py-4">
        <Link href={BRAND.siteUrl} className="flex items-center gap-3" target="_blank" rel="noreferrer">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={BRAND.name} className="h-7 object-contain" />
          ) : (
            <span className="text-base font-semibold tracking-[0.32em] text-foreground sm:text-lg">
              {BRAND.name}
            </span>
          )}
        </Link>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="hidden rounded-full bg-white/70 px-3 py-1 gap-1.5 font-normal ring-1 ring-black/[0.04] sm:inline-flex">
            <Headphones className="size-3.5" />
            Підтримка KAYER
          </Badge>
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
