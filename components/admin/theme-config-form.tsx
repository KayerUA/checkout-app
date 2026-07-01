"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle2, Loader2 } from "lucide-react";

export function ThemeConfigForm() {
  const [logoUrl, setLogoUrl] = useState("https://kayer.ua/cdn/shop/files/logo.png");
  const [buttonText, setButtonText] = useState("Оформити замовлення");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch("/api/merchant/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          themeConfig: { logoUrl, buttonText },
          checkoutBaseUrl: window.location.origin,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Помилка");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="logoUrl">URL логотипу</Label>
        <Input
          id="logoUrl"
          value={logoUrl}
          onChange={(e) => setLogoUrl(e.target.value)}
          placeholder="https://kayer.ua/..."
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="buttonText">Текст кнопки оплати</Label>
        <Input
          id="buttonText"
          value={buttonText}
          onChange={(e) => setButtonText(e.target.value)}
        />
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertDescription>Тему збережено</AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={loading}>
        {loading && <Loader2 className="size-4 animate-spin" />}
        Зберегти тему
      </Button>
    </form>
  );
}
