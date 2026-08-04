export function SplashScreen({ label, logo }: { label: string; logo: React.ReactNode }) {
  return (
    <main className="app-drag-region flex min-h-screen items-center justify-center bg-sidebar text-white">
      <div className="flex animate-fade-in flex-col items-center">
        <div className="animate-soft-rise">{logo}</div>
        <div className="mt-8 h-1 w-32 overflow-hidden rounded-full bg-white/10">
          <span className="block h-full w-1/2 animate-loading-bar rounded-full bg-accent" />
        </div>
        <p className="mt-4 text-sm text-neutral-400">{label}</p>
      </div>
    </main>
  );
}
