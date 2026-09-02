export function SiteFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="border-t border-[var(--color-border)] bg-[var(--color-bg)]">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-10 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <span className="relative flex h-5 w-5 items-center justify-center">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-sunset)]" />
            <span className="absolute inset-0 rounded-full border border-white/15" />
          </span>
          <span className="font-mono text-[12px] uppercase tracking-[1.2px] text-muted">
            Open Scientist · {year}
          </span>
        </div>
        <div className="flex items-center gap-6 font-mono text-[12px] uppercase tracking-[1.2px] text-muted">
          <span>Solar Physics · Multi-Agent</span>
          <span className="hidden sm:inline">Corona Heating · Track 1B</span>
        </div>
      </div>
    </footer>
  )
}
