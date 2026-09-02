'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils/cn'

interface SiteHeaderProps {
  children?: React.ReactNode
}

const NAV_LINKS = [
  { href: '/', label: 'Projects' },
  { href: '/settings', label: 'Settings' },
]

export function SiteHeader({ children }: SiteHeaderProps) {
  const pathname = usePathname()

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-10">
          {/* Logo — mono caps wordmark */}
          <Link href="/" className="group flex items-center gap-2.5">
            <span className="relative flex h-7 w-7 items-center justify-center">
              {/* Inner dot */}
              <span className="h-2 w-2 rounded-full bg-[var(--color-sunset)]" />
              {/* Rotating corona ring */}
              <span className="absolute inset-0 animate-spin-slow rounded-full border border-white/20" />
              {/* Static outer hairline */}
              <span className="absolute -inset-1 rounded-full border border-[var(--color-border)]" />
            </span>
            <span className="font-mono text-[14px] font-normal uppercase tracking-[1.6px] text-white">
              Open Scientist
            </span>
          </Link>

          {/* Nav links — pill on active */}
          <nav className="hidden items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => {
              const active = pathname === link.href
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={cn(
                    'rounded-full px-3 py-1 text-[14px] font-normal transition-colors',
                    active ? 'bg-white/[0.06] text-white' : 'text-muted hover:text-white',
                  )}
                >
                  {link.label}
                </Link>
              )
            })}
          </nav>
        </div>

        {children}
      </div>
    </header>
  )
}
