'use client'

import { Activity, ArrowRight, FileCheck2, Settings2, SunMedium, Waves } from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { GravityStarsBackground } from '@/components/backgrounds/gravity-stars'
import { ProjectList } from '@/components/projects/project-list'

const RESEARCH_FOCUS = [
  { label: '研究对象', title: '不同活动区的多波段升温与结构响应', note: '关注 EUV、软 X 射线、磁场诊断和数值模拟中出现的时空差异。', icon: Activity },
  { label: '待比较机制', title: '阿尔芬波耗散、磁重联纳耀斑及其耦合', note: '不预设唯一答案；允许不同机制在不同活动区具有不同贡献。', icon: Waves },
  { label: '项目产出', title: '候选机制、可复核证据与下一步验证计划', note: '把支持、反例和未知部分留在同一个项目中，供下一轮继续检验。', icon: FileCheck2 },
]

export default function HomePage() {
  return (
    <div className="home-shell">
      <header className="home-header">
        <Link href="/" className="home-brand">
          <span className="home-brand-mark"><SunMedium className="h-5 w-5" /></span>
          <span><span className="home-brand-kicker">SCIENCE WORKSPACE</span><span className="home-brand-name">太阳物理分析台</span></span>
        </Link>
        <Link href="/settings" className="home-settings"><Settings2 className="h-4 w-4" />设置</Link>
      </header>

      <main>
        <section className="home-hero">
          <div className="home-hero-photo" aria-hidden>
            <img src="/sun-304a.jpg" alt="" />
          </div>
          <div className="home-hero-glow" aria-hidden />
          <GravityStarsBackground
            className="absolute inset-0"
            style={{ color: '#ffd9b0' }}
            starsCount={220}
            starsSize={1.6}
            starsOpacity={0.7}
            glowIntensity={10}
            movementSpeed={0.2}
            mouseInfluence={80}
            gravityStrength={60}
          />
          <GravityStarsBackground
            className="absolute inset-0"
            style={{ color: 'var(--color-sunset-soft)' }}
            starsCount={26}
            starsSize={3.6}
            starsOpacity={1}
            glowIntensity={22}
            movementSpeed={0.45}
            mouseInfluence={130}
            gravityStrength={90}
          />
          <div className="home-hero-fade" aria-hidden />
          <motion.div className="home-hero-copy" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5, ease: 'easeOut' }}>
            <span className="home-hero-kicker">日冕加热之谜</span>
            <h1 className="home-title">日冕加热<span className="home-title-accent">机制辨析</span></h1>
            <p className="home-lede">面向不同活动区的多波段观测与数值模拟，比较阿尔芬波耗散、磁重联纳耀斑及其耦合，寻找能够区分不同加热机制的观测证据。</p>
            <div className="home-actions">
              <a href="#projects" className="home-primary-action group">进入项目<ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" /></a>
              <Link href="/projects/coronal-heating-demo" className="home-secondary-action group">查看研究示例<ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" /></Link>
            </div>
          </motion.div>
        </section>

        <section className="home-research-section" aria-label="研究任务">
          <div className="home-research-panel" aria-label="日冕加热研究内容">
            <div className="home-research-panel-header"><div><span>研究任务</span><h2>不同活动区为何呈现不同的加热特征？</h2></div></div>
            <p className="home-research-question">从一个具体活动区的现象出发，判断现有观测是否更支持某一种机制、机制组合，或仍然不足以区分。</p>
            <div className="home-research-list">
              {RESEARCH_FOCUS.map((item) => { const Icon = item.icon; return <article key={item.label}><span className="home-research-icon"><Icon className="h-3.5 w-3.5" /></span><div><small>{item.label}</small><strong>{item.title}</strong><p>{item.note}</p></div></article> })}
            </div>
            <div className="home-research-panel-footer"><span>资料不足时，系统保留为未知，而不是给出确定结论。</span></div>
          </div>
        </section>

        <motion.section
          id="projects"
          className="home-projects-section"
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          <ProjectList onOpen={(name) => { window.location.href = `/projects/${name}` }} />
        </motion.section>
      </main>
    </div>
  )
}
