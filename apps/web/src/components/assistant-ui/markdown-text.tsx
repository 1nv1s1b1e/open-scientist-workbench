/**
 * MarkdownText — 消息文本 part 渲染器（轻量 markdown 支持）。
 *
 * 不依赖 react-markdown 等重型库，只做最小处理：
 * - code fence ``` → <pre>
 * - `inline code` → <code>
 * - **bold** → <strong>
 * - 段落 + 换行
 */

'use client'

import { useMemo } from 'react'

interface MarkdownTextProps {
  text: string
}

/** 行内 markdown：`code` 和 **bold** */
function renderInline(text: string, baseKey: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const regex = /(`[^`]+`|\*\*[^*]+\*\*)/g
  let lastIdx = 0
  let key = 0
  let match = regex.exec(text)
  while (match !== null) {
    if (match.index > lastIdx) {
      nodes.push(text.slice(lastIdx, match.index))
    }
    const token = match[0]!
    if (token.startsWith('`')) {
      nodes.push(
        <code
          key={`${baseKey}-c-${key}`}
          className="rounded-sm bg-[var(--color-surface)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--color-sunset)]"
        >
          {token.slice(1, -1)}
        </code>,
      )
    } else {
      nodes.push(
        <strong key={`${baseKey}-b-${key}`} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>,
      )
    }
    key += 1
    lastIdx = regex.lastIndex
    match = regex.exec(text)
  }
  if (lastIdx < text.length) nodes.push(text.slice(lastIdx))
  return nodes
}

export function MarkdownText({ text }: MarkdownTextProps) {
  if (!text.trim()) return null
  // Detect if the entire text is a JSON object/array → pretty-print it
  const jsonBlock = useMemo(() => {
    const trimmed = text.trim()
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        return JSON.parse(trimmed)
      } catch {
        // not valid JSON, fall through to normal markdown
      }
    }
    return null
  }, [text])

  const blocks = useMemo(() => {
    // 切分 code fence
    const parts = text.split(/(```[\s\S]*?```)/g)
    return parts.map((part, i) => {
      if (part.startsWith('```')) {
        const content = part.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '')
        return { type: 'code' as const, content, key: `block-${i}` }
      }
      return { type: 'text' as const, content: part, key: `block-${i}` }
    })
  }, [text])

  if (jsonBlock !== null) {
    return (
      <pre className="overflow-x-auto rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-mono text-[11px] leading-relaxed text-muted">
        {JSON.stringify(jsonBlock, null, 2)}
      </pre>
    )
  }

  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-body">
      {blocks.map((block) => {
        if (block.type === 'code') {
          return (
            <pre
              key={block.key}
              className="overflow-x-auto rounded-sm border border-[var(--color-border)] bg-[var(--color-bg)] p-3 font-mono text-[12px] leading-relaxed text-muted"
            >
              {block.content}
            </pre>
          )
        }
        // 段落处理：双换行分段
        const paragraphs = block.content.split(/\n\n+/)
        return paragraphs.map((para, pi) => {
          if (para.trim() === '') return null
          const lines = para.split('\n')
          const paraKey = `${block.key}-p-${pi}`
          return (
            <p key={paraKey} className="whitespace-pre-wrap">
              {lines.map((line, li) => {
                const lineKey = `${paraKey}-l-${li}-${line.slice(0, 8)}`
                return (
                  <span key={lineKey}>
                    {renderInline(line, lineKey)}
                    {li < lines.length - 1 && <br />}
                  </span>
                )
              })}
            </p>
          )
        })
      })}
    </div>
  )
}
