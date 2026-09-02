'use client'

import { ArrowUpRight } from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { SCIENTIFIC_AGENT_DISPLAY_NAMES, scientificAgentIdentity } from '@open-scientist/schema'
import { Eyebrow } from './eyebrow'
import { DEMO_PHENOMENON } from '@/lib/workbench/demo-data'

/** "Codename · stage" tag, e.g. "Oracle · B", matching backend traces. */
function agentTag(key: string): string {
  const identity = scientificAgentIdentity(key)
  return identity ? `${identity.codename} · ${identity.stage}` : key
}

const AGENTS = [
  [SCIENTIFIC_AGENT_DISPLAY_NAMES.sisyphus, agentTag('sisyphus'), 'A → B → C → D 的闭环编排', '#f97316'],
  [SCIENTIFIC_AGENT_DISPLAY_NAMES.librarian, agentTag('librarian'), '现象检索与候选机制组合', '#10b981'],
  [SCIENTIFIC_AGENT_DISPLAY_NAMES.looker, agentTag('looker'), '多波段图像与时间序列质控', '#06b6d4'],
  [SCIENTIFIC_AGENT_DISPLAY_NAMES.explore, agentTag('explore'), '历史样本与定量诊断分析', '#8b5cf6'],
  [SCIENTIFIC_AGENT_DISPLAY_NAMES.oracle, agentTag('oracle'), '反例查找与事实校正', '#ef4444'],
  [SCIENTIFIC_AGENT_DISPLAY_NAMES.prometheus, agentTag('prometheus'), '下一步验证与闭环反馈', '#f59e0b'],
] as const

const FLOW = [
  ['A', '提出候选机制', 'RAG + 模型思考', '#8ee8c2'],
  ['B', '找证据与反例', '观测质控 / 物理诊断 / 反证审计', '#a0c3ec'],
  ['C', '给出边界结论', '支持 · 反驳 · 未知', '#f6c77d'],
  ['D', '安排下一步', '验证或反馈到 B', '#c8a7ff'],
] as const

export function HomeSciencePreview() {
  // preview content
  return (
    <div data-testid='home-science-preview'>
      <section className='border-b border-[var(--color-border)] bg-[var(--color-bg)]'><div className='mx-auto max-w-6xl px-6 py-14'><Eyebrow size='lg'>The Scientific Question</Eyebrow><h2 className='mt-3 max-w-2xl text-3xl font-normal tracking-tight text-white'>不是直接选一个理论，而是比较它们能否解释同一组现象。</h2></div></section>
      <section className='border-b border-[var(--color-border)] bg-[var(--color-bg)]'><div className='mx-auto max-w-6xl px-6 py-14'><div className='grid gap-px overflow-hidden rounded-sm border border-[var(--color-border)] bg-[var(--color-border)] lg:grid-cols-[1.25fr_.75fr]'><div className='bg-[var(--color-bg)] p-6'><div className='font-mono text-[11px] uppercase tracking-[1.2px] text-cyan-200/70'>真实输入示例 · {DEMO_PHENOMENON.activeRegion}</div><p className='mt-5 text-lg leading-8 text-white'>{DEMO_PHENOMENON.description}</p><div className='mt-6 flex flex-wrap gap-2'>{DEMO_PHENOMENON.observations.map((item) => <span key={item.sourceId} className='rounded-full border border-cyan-200/15 bg-cyan-200/[.05] px-3 py-1.5 font-mono text-[11px] text-cyan-100/75'>{item.instrument} · {item.wavelengthOrBand}</span>)}</div></div><div className='bg-[var(--color-surface)] p-6'><div className='font-mono text-[11px] uppercase tracking-[1.2px] text-orange-100/60'>本地资料模式</div><div className='mt-6 grid grid-cols-3 gap-4'><div><div className='text-3xl text-white'>动态</div><div className='mt-1 text-xs text-muted'>候选机制</div></div><div><div className='text-3xl text-white'>10</div><div className='mt-1 text-xs text-muted'>核验文献</div></div><div><div className='text-3xl text-white'>2</div><div className='mt-1 text-xs text-muted'>活动区数据</div></div></div><div className='mt-7 border-t border-[var(--color-border)] pt-5 text-sm leading-6 text-body'>当前模式直接使用本地文献索引和 FITS 数据目录，不调用第三方模型；每项结果保留来源和处理边界。</div></div></div></div></section>
      <section className='border-b border-[var(--color-border)] bg-[var(--color-bg)]'><div className='mx-auto max-w-6xl px-6 py-14'><div className='flex items-end justify-between gap-4'><div><Eyebrow size='lg'>One Loop · Four Responsibilities</Eyebrow><h2 className='mt-3 text-3xl text-white'>每一轮都留下可以复核的中间结果。</h2></div><Link href='/projects/coronal-heating-demo' className='hidden items-center gap-1.5 font-mono text-[12px] uppercase tracking-[1.1px] text-muted hover:text-white md:flex'>进入工作台<ArrowUpRight className='h-3.5 w-3.5' /></Link></div><div className='mt-9 grid gap-px overflow-hidden rounded-sm border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-2 lg:grid-cols-4'>{FLOW.map(([key, title, text, color]) => <motion.div key={key} className='bg-[var(--color-bg)] p-5'><div className='flex items-center justify-between'><span className='font-mono text-[12px]' style={{ color }}>{key}</span><span className='h-1.5 w-1.5 rounded-full' style={{ backgroundColor: color }} /></div><h3 className='mt-8 text-base text-white'>{title}</h3><p className='mt-2 font-mono text-[11px] uppercase tracking-[.8px] text-muted'>{text}</p></motion.div>)}</div></div></section>
      <section className='border-b border-[var(--color-border)] bg-[var(--color-bg)]'><div className='mx-auto max-w-6xl px-6 py-14'><Eyebrow size='lg'>Six Agents · One Research Desk</Eyebrow><div className='mt-8 grid gap-px overflow-hidden rounded-sm border border-[var(--color-border)] bg-[var(--color-border)] sm:grid-cols-2 lg:grid-cols-3'>{AGENTS.map(([role, tag, desc, color], index) => <motion.div key={role} className='bg-[var(--color-bg)] p-6 transition-colors hover:bg-[var(--color-surface-soft)]'><div className='flex items-center justify-between'><span className='font-mono text-[11px] uppercase tracking-[1.4px] text-muted'>{String(index + 1).padStart(2, '0')}</span><span className='h-1.5 w-1.5 rounded-full' style={{ backgroundColor: color }} /></div><h3 className='mt-5 text-2xl text-white'>{role}</h3><p className='mt-1 font-mono text-[12px] uppercase tracking-[1.1px]' style={{ color }}>{tag}</p><p className='mt-3 text-[14px] leading-relaxed text-muted'>{desc}</p></motion.div>)}</div></div></section>
      <section className='relative overflow-hidden border-b border-[var(--color-border)] bg-[var(--color-bg)]'><div className='bg-radial-dusk pointer-events-none absolute inset-0' /><div className='relative mx-auto flex max-w-6xl flex-col items-center gap-12 px-6 py-20 text-center md:flex-row md:justify-between md:text-left'><div className='max-w-xl'><Eyebrow size='lg'>The Mystery</Eyebrow><h2 className='mt-4 text-display-sm text-white'>为什么日冕比光球还要热？</h2><p className='mt-5 text-base leading-relaxed text-body'>光球温度约 5,800 K，而日冕却高达 1–3 MK。不同机制可以耦合，但每一种贡献都需要被观测和模拟共同约束。</p></div><motion.div animate={{ rotate: 360 }} transition={{ duration: 30, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }} className='relative flex h-48 w-48 shrink-0 items-center justify-center rounded-full border border-orange-200/20' style={{ background: 'conic-gradient(from 0deg, transparent, rgba(255,122,23,.25), transparent, rgba(124,58,237,.18), transparent)' }}><div className='h-24 w-24 rounded-full' style={{ background: 'radial-gradient(circle, rgba(255,122,23,.62), rgba(255,122,23,.12) 52%, transparent 75%)' }} /><span className='absolute -bottom-8 font-mono text-[11px] uppercase tracking-[1.4px] text-muted'>Corona · 1–3 MK</span></motion.div></div></section>
    </div>
  )
}
