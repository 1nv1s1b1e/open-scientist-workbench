'use client'

import { ArrowRight, Flame, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { ProjectList } from '@/components/projects/project-list'
import { Banner, Eyebrow, SiteFooter, SiteHeader } from '@/components/site'

export default function HomePage() {
  return (
    <div className="relative min-h-screen">
      <SiteHeader />

      {/* ── Hero banner ─────────────────────────────────────────────────────── */}
      <Banner
        eyebrow="Solar Physics · Multi-Agent Reasoning"
        title="日冕加热之谜"
        description="基于 Co-Scientist + AlphaEvolve 的太阳物理多智能体假设生成与证据推理系统。六位 AI 协作者——Sisyphus、Librarian、Looker、Explore、Oracle、Prometheus——围绕日冕高温悖论展开锦标赛演化。"
        size="xl"
        accent="sunset"
      >
        <div className="flex flex-wrap items-center gap-3">
          <Link href="#projects" className="pill-primary group">
            <Sparkles className="h-4 w-4" />
            开始推理
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link href="/settings" className="pill-outline">
            配置模型
          </Link>
        </div>
      </Banner>

      {/* ── Agent strip — six mono-eyebrow cells with hairline grid ────────── */}
      <section className="border-b border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <Eyebrow size="lg">Six Agents · One Tournament</Eyebrow>

          <div className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-sm border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-2 lg:grid-cols-3">
            {AGENTS.map((agent, i) => (
              <motion.div
                key={agent.role}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.1 + i * 0.05 }}
                className="group relative bg-[var(--color-bg)] p-6 transition-colors hover:bg-[var(--color-surface-soft)]"
              >
                {/* Agent index */}
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] uppercase tracking-[1.4px] text-muted">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: agent.color }}
                  />
                </div>
                {/* Role name — display scale */}
                <h3 className="mt-5 text-2xl font-normal tracking-tight text-white">
                  {agent.role}
                </h3>
                {/* Tag — mono colored */}
                <p
                  className="mt-1 font-mono text-[11px] uppercase tracking-[1.4px]"
                  style={{ color: agent.color }}
                >
                  {agent.tag}
                </p>
                {/* Desc */}
                <p className="mt-3 text-[13px] leading-relaxed text-muted">{agent.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Projects ────────────────────────────────────────────────────────── */}
      <section id="projects" className="bg-[var(--color-bg)]">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
          >
            <ProjectList onOpen={(name) => (window.location.href = `/projects/${name}`)} />
          </motion.div>
        </div>
      </section>

      {/* ── Solar disk decorative band ──────────────────────────────────────── */}
      <section className="relative overflow-hidden border-y border-[var(--color-border)] bg-[var(--color-bg)]">
        <div className="bg-radial-dusk pointer-events-none absolute inset-0" />
        <div className="bg-grid pointer-events-none absolute inset-0 opacity-30" />
        <div className="relative mx-auto flex max-w-6xl flex-col items-center gap-12 px-6 py-24 text-center md:flex-row md:justify-between md:text-left">
          <div className="max-w-xl">
            <Eyebrow size="lg">The Mystery</Eyebrow>
            <h3 className="mt-4 text-display-sm font-normal text-white">
              为什么日冕比光球还要热？
            </h3>
            <p className="mt-5 text-base leading-relaxed text-body">
              光球温度约 5,800 K，而日冕却高达 1–3 MK——温度反向跃升违背直觉。Alfvén
              波耗散、纳耀斑磁重联、等离子体不稳定性……六位智能体将围绕候选假设演化辩论。
            </p>
          </div>

          {/* Animated corona disk */}
          <motion.div
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className="relative flex h-52 w-52 shrink-0 items-center justify-center"
          >
            {/* Outer rotating ring — conic gradient */}
            <motion.div
              animate={{ rotate: 360 }}
              transition={{ duration: 30, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
              className="absolute inset-0 rounded-full border border-white/10"
              style={{
                background:
                  'conic-gradient(from 0deg, transparent 0%, rgba(255,122,23,0.18) 25%, transparent 50%, rgba(124,58,237,0.14) 75%, transparent 100%)',
              }}
            />
            {/* Middle counter-rotating ring */}
            <motion.div
              animate={{ rotate: -360 }}
              transition={{ duration: 45, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
              className="absolute inset-5 rounded-full border border-white/[0.08]"
            />
            {/* Outer hairline */}
            <div className="absolute -inset-3 rounded-full border border-[var(--color-border)]" />
            {/* Inner glow */}
            <motion.div
              animate={{
                scale: [1, 1.08, 1],
                opacity: [0.6, 0.85, 0.6],
              }}
              transition={{ duration: 4, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
              className="flex h-24 w-24 items-center justify-center rounded-full"
              style={{
                background:
                  'radial-gradient(circle, rgba(255,122,23,0.5) 0%, rgba(255,122,23,0.15) 50%, transparent 80%)',
              }}
            >
              <Flame className="h-9 w-9 text-[var(--color-sunset-soft)]" />
            </motion.div>
            {/* Bottom label */}
            <span className="absolute -bottom-10 font-mono text-[10px] uppercase tracking-[1.4px] text-muted">
              Corona · 1–3 MK
            </span>
          </motion.div>
        </div>
      </section>

      <SiteFooter />
    </div>
  )
}

const AGENTS = [
  { role: 'Sisyphus', tag: 'Orchestrator', desc: '编排锦标赛演化', color: '#3b82f6' },
  { role: 'Librarian', tag: 'RAG', desc: '检索 + 初始假设', color: '#10b981' },
  { role: 'Looker', tag: 'Multimodal', desc: 'FITS 图像对齐', color: '#06b6d4' },
  { role: 'Explore', tag: 'Evaluator', desc: 'Python 搜索 + F1', color: '#8b5cf6' },
  { role: 'Oracle', tag: 'Critic', desc: '批判 + 突变', color: '#ef4444' },
  { role: 'Prometheus', tag: 'Planner', desc: 'MHD 配置 + 观测', color: '#f59e0b' },
]
