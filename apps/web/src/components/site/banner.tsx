'use client'

import { motion } from 'motion/react'
import { Eyebrow } from './eyebrow'

interface BannerProps {
  eyebrow: string
  title: string
  description?: string
  accent?: 'sunset' | 'dusk' | 'breeze'
  size?: 'sm' | 'md' | 'lg' | 'xl'
  children?: React.ReactNode
}

const SIZE_CLASS: Record<NonNullable<BannerProps['size']>, string> = {
  sm: 'text-display-sm',
  md: 'text-display-md',
  lg: 'text-display-lg',
  xl: 'text-display-xl',
}

const ACCENT_RADIAL: Record<NonNullable<BannerProps['accent']>, string> = {
  sunset: 'bg-radial-sunset',
  dusk: 'bg-radial-dusk',
  breeze: '',
}

export function Banner({
  eyebrow,
  title,
  description,
  accent = 'sunset',
  size = 'md',
  children,
}: BannerProps) {
  return (
    <section className="relative overflow-hidden border-b border-[var(--color-border)] bg-[var(--color-bg)]">
      {/* Radial glow */}
      <div className={`pointer-events-none absolute inset-0 ${ACCENT_RADIAL[accent]}`} />
      {/* Engineering grid */}
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-60" />
      {/* Top hairline sunset accent */}
      <div className="accent-line-top pointer-events-none absolute inset-x-0 top-0" />
      {/* Bottom fade into canvas */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-[var(--color-border)] to-transparent" />

      <div className="relative z-10 mx-auto max-w-6xl px-6 py-16 md:py-20">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        >
          <Eyebrow size="lg">{eyebrow}</Eyebrow>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.08, ease: 'easeOut' }}
          className={`mt-4 ${SIZE_CLASS[size]} font-normal text-white`}
        >
          {title}
        </motion.h1>

        {description && (
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.18, ease: 'easeOut' }}
            className="mt-5 max-w-2xl text-base leading-relaxed text-body"
          >
            {description}
          </motion.p>
        )}

        {children && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.28, ease: 'easeOut' }}
            className="mt-8"
          >
            {children}
          </motion.div>
        )}
      </div>
    </section>
  )
}
