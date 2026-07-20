'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import type {
  ConceptCategory,
  ConceptLink,
  ConceptNetData,
  ConceptNode,
} from '@/lib/types/visualizers'
import { CONCEPT_COLORS } from '@/lib/visualizers/colorTheme'
import { EMPTY_CONCEPT_NET } from '@/lib/visualizers/concept-net-data'

const ForceGraph3D = dynamic(() => import('react-force-graph-3d'), { ssr: false })

const LINK_COLORS: Record<ConceptLink['kind'], string> = {
  supports: '#10b981',
  contradicts: '#ef4444',
  extends: '#3b82f6',
  references: '#8b92ad',
}

function createLabelSprite(label: string, color: string): THREE.Sprite {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const fontSize = 56
  ctx.font = `${fontSize}px sans-serif`
  const padding = 16
  canvas.width = ctx.measureText(label).width + padding * 2
  canvas.height = fontSize + padding * 2
  ctx.font = `${fontSize}px sans-serif`
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.fillText(label, padding, canvas.height / 2)
  const texture = new THREE.CanvasTexture(canvas)
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true })
  const sprite = new THREE.Sprite(material)
  sprite.scale.set(canvas.width / 40, canvas.height / 40, 1)
  return sprite
}

export function ConceptNet3D({ data = EMPTY_CONCEPT_NET }: { data?: ConceptNetData }) {
  const containerRef = useRef<HTMLDivElement>(null)
  // react-force-graph-3d 的动态导入没有导出可用类型，用最小结构接口约束
  const graphRef = useRef<{
    nodeColor: (fn: (node: ConceptNode) => string) => unknown
    nodeRelSize: (fn: (node: ConceptNode) => number) => unknown
    nodeOpacity: (n: number) => unknown
    linkColor: (fn: (link: ConceptLink) => string) => unknown
    linkWidth: (n: number) => unknown
    linkOpacity: (n: number) => unknown
    linkDirectionalParticles: (n: number) => unknown
    linkDirectionalParticleWidth: (n: number) => unknown
    backgroundColor: (s: string) => unknown
    nodeThreeObject: (fn: (node: ConceptNode) => THREE.Sprite) => unknown
    onNodeClick: (fn: (node: ConceptNode) => void) => unknown
    width: (n: number) => unknown
    height: (n: number) => unknown
  } | null>(null)

  const degreeMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const link of data.links) {
      map.set(link.source, (map.get(link.source) ?? 0) + 1)
      map.set(link.target, (map.get(link.target) ?? 0) + 1)
    }
    return map
  }, [data.links])

  useEffect(() => {
    const graph = graphRef.current
    if (!graph) return
    graph.nodeColor((node: ConceptNode) => CONCEPT_COLORS[node.category] ?? '#8b5cf6')
    graph.nodeRelSize((node: ConceptNode) => 4 + (degreeMap.get(node.id) ?? 0) * 1.2)
    graph.nodeOpacity(0.9)
    graph.linkColor((link: ConceptLink) => LINK_COLORS[link.kind] ?? '#8b92ad')
    graph.linkWidth(0.6)
    graph.linkOpacity(0.5)
    graph.linkDirectionalParticles(2)
    graph.linkDirectionalParticleWidth(0.4)
    graph.backgroundColor('rgba(0,0,0,0)')
    graph.nodeThreeObject((node: ConceptNode) => {
      const color =
        node.state === 'faded'
          ? '#4b5563'
          : (CONCEPT_COLORS[node.category as ConceptCategory] ?? '#8b5cf6')
      const sprite = createLabelSprite(node.label, color)
      return sprite
    })
    graph.onNodeClick((node: ConceptNode) => console.log('[concept-net] node clicked', node.id))
    graph.width(containerRef.current?.clientWidth ?? 600)
    graph.height(containerRef.current?.clientHeight ?? 400)
  }, [degreeMap])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const graph = graphRef.current
      if (!graph) return
      graph.width(el.clientWidth)
      graph.height(el.clientHeight)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="force-graph-container h-full w-full">
      <ForceGraph3D ref={graphRef as never} graphData={data} cooldownTicks={100} />
    </div>
  )
}

export default ConceptNet3D
