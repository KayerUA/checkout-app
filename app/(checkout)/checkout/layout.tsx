export default function CheckoutLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="theme-kayer flex min-h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_50%_-10%,rgba(218,183,164,0.35),transparent_36rem),linear-gradient(180deg,rgba(255,255,255,0.88),rgba(247,243,240,0.96)_42%,rgba(250,249,247,1))]" />
      {children}
    </div>
  );
}
