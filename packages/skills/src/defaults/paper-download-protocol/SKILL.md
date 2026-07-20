---
name: paper-download-protocol
description: Paper download and full-text extraction protocol. Use when downloading arXiv/PubMed/bioRxiv papers via paper-search-mcp and extracting text for hypothesis grounding. Defines OA-first fallback chain, local storage, and citation extraction.
---

# Paper Download Protocol

你是 Librarian，需要下载学术论文全文并提取文本以支撑假设生成。本 skill 指导你如何用 `paper-search-mcp` 的 `download_with_fallback` + `read_paper` 工具链完成 OA-first 下载、本地管理、引用提取。

## 1. 下载流程

```
search_papers(query, sources, limit) 
  → 拿到 Paper[]（含 doi / arxiv_id / url）
  → 筛选 top-N（按 relevance + year + source 可靠性）
  → download_with_fallback(paper) 
     → OA-first fallback chain:
        1. 源站直链（arXiv PDF / PMC / bioRxiv）
        2. OpenAIRE / CORE / Europe PMC 发现
        3. Unpaywall DOI 解析（需 PAPER_SEARCH_MCP_UNPAYWALL_EMAIL）
        4. (可选) Sci-Hub —— 默认不启用
     → 返回 local_path 或 error
  → read_paper(local_path) 
     → 提取全文 markdown（含 sections / figures caption / references）
```

## 2. 筛选 top-N 策略

- **N = 3-5**（单轮下载不要超过 5 篇，避免 token 爆炸）。
- 优先级：
  1. `source = arXiv`（开放 + 稳定下载）
  2. `source = bioRxiv/medRxiv`（开放）
  3. `source = PMC/Europe PMC`（OA only）
  4. `source = Semantic Scholar`（OA 标记的）
  5. 其他（可能下载失败，fallback 链会尝试）
- 若 `search_papers` 返回 ≤ 3 篇，全下；若 > 5 篇，按 `year desc` + `abstract 关键词命中数` 排序取 top-5。

## 3. 本地存储

`paper-search-mcp` 默认存到 `~/.paper-search-mcp/papers/`。open-scientist agent 不直接管理存储——每次 `read_paper` 调用传 `local_path`（由 `download_with_fallback` 返回）即可。

**不要**用 bash 工具手动 `curl` 下载 PDF——`paper-search-mcp` 已处理 UA / rate limit / fallback。

## 4. 引用提取

`read_paper` 返回的 markdown 含 References 节。提取引用时：
- 优先取 `[arXiv:ID]` 或 `doi:10.xxxx/...` 格式。
- 若返回纯文本无结构化引用，用正则 `\b\d{4}\.\d{4,5}\b` 扫 arXiv ID。
- 引用进入假设 rationale 时格式：`[author2024, arXiv:2401.12345]`。

## 5. 容错

- `download_with_fallback` 返回 error（paywall / 镜像挂）→ 跳过该篇，换下一篇，**不**重试。
- `read_paper` 返回空 / 乱码 → 该篇标记「全文不可用」，仅用 `search_papers` 返回的 abstract。
- 工具未配置 → 跳过下载，仅用 HelixDB 本地知识库（`searchPapers` / `searchHypotheses`）。

## 6. 与 HelixDB 的协作

- `paper-search-mcp` 是**外部检索**（arXiv/PubMed/...）。
- `searchPapers` / `searchHypotheses`（open-scientist 自有工具）是**本地 HelixDB 检索**（已入库的 paper + hypothesis）。
- 流程：先 `searchPapers`（本地，快）→ 不够再 `search_papers`（外部，慢但全）→ 下载全文 → `addHypothesis` 时在 rationale 引用。
- 下载的 paper **不**自动入 HelixDB（避免重复）——若需入库，用 `addPaper` 工具显式写入。
