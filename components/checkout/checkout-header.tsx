import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ShieldCheck } from "lucide-react";

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
    <header className="border-b bg-card">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href={BRAND.siteUrl} className="flex items-center gap-3" target="_blank" rel="noreferrer">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt={BRAND.name} className="h-7 object-contain" />
          ) : (
            <span className="text-lg font-semibold tracking-[0.3em] text-foreground">
              {BRAND.name}
            </span>
          )}
        </Link>
        <Badge variant="secondary" className="gap-1.5 font-normal">
          <ShieldCheck className="size-3.5" />
          <span className="hidden sm:inline">Безпечна оплата</span>
        </Badge>
      </div>
      <Separator />
    </header>
  );
}

export { BRAND };
