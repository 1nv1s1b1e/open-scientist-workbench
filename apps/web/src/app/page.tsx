'use client'

import { Activity, ArrowRight, FileCheck2, Settings2, SunMedium, Waves } from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
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
          <span className="home-brand-mark"><SunMedium className="h-4 w-4" /></span>
          <span><span className="home-brand-kicker">SCIENCE WORKSPACE</span><span className="home-brand-name">太阳物理分析台</span></span>
        </Link>
        <Link href="/settings" className="home-settings"><Settings2 className="h-3.5 w-3.5" />设置</Link>
      </header>

      <main>
        <section className="home-hero">
          <motion.div className="home-hero-copy" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .5, ease: 'easeOut' }}>
            <span className="home-hero-kicker">日冕加热之谜</span>
            <h1 className="home-title">日冕加热<span className="home-title-accent">机制辨析</span></h1>
            <p className="home-lede">面向不同活动区的多波段观测与数值模拟，比较阿尔芬波耗散、磁重联纳耀斑及其耦合，寻找能够区分不同加热机制的观测证据。</p>
            <div className="home-actions">
              <a href="#projects" className="home-primary-action">进入项目<ArrowRight className="h-3.5 w-3.5" /></a>
              <Link href="/projects/coronal-heating-demo" className="home-secondary-action">查看研究示例</Link>
            </div>
          </motion.div>

          <motion.div className="home-hero-art" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .6, delay: .08, ease: 'easeOut' }}>
            <div className="home-research-panel" aria-label="日冕加热研究内容">
              <div className="home-research-panel-header"><div><span>研究任务</span><h2>不同活动区为何呈现不同的加热特征？</h2></div><SunMedium className="h-5 w-5" /></div>
              <p className="home-research-question">从一个具体活动区的现象出发，判断现有观测是否更支持某一种机制、机制组合，或仍然不足以区分。</p>
              <div className="home-research-list">
                {RESEARCH_FOCUS.map((item) => { const Icon = item.icon; return <article key={item.label}><span className="home-research-icon"><Icon className="h-3.5 w-3.5" /></span><div><small>{item.label}</small><strong>{item.title}</strong><p>{item.note}</p></div></article> })}
              </div>
              <div className="home-research-panel-footer"><span>资料不足时，系统保留为未知，而不是给出确定结论。</span><span>查看项目 <ArrowRight className="h-3 w-3" /></span></div>
            </div>
          </motion.div>
        </section>

        <section className="home-scope-strip" aria-label="项目内容">
          <div className="home-scope-item"><span className="home-scope-index">输入</span><strong>活动区现象</strong><p>输入带有观测或模拟背景的活动区变化，不要求预先整理成固定数据格式。</p></div>
          <div className="home-scope-item"><span className="home-scope-index">比较</span><strong>加热机制组合</strong><p>比较波动耗散、磁重联及其耦合在不同活动区中的可能贡献。</p></div>
          <div className="home-scope-item"><span className="home-scope-index">产出</span><strong>证据与验证计划</strong><p>形成候选解释、反例与未知边界，并给出下一步观测或模拟任务。</p></div>
        </section>

        <section id="projects" className="home-projects-section">
          <ProjectList onOpen={(name) => { window.location.href = `/projects/${name}` }} />
        </section>
      </main>
    </div>
  )
}
