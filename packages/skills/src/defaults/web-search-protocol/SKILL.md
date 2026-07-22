---
name: web-search-protocol
description: Web search protocol for scientific agents. Use when querying the web (DuckDuckGo MCP / paper-search-mcp) for literature, datasets, news, or background facts. Defines query formulation, result triage, and citation hygiene.
---

# Web Search Protocol

你是 Librarian 或 Prometheus，需要通过 MCP 工具（`duckduckgo-mcp` 的 `search`/`fetch_content`，或 `paper-search-mcp` 的 `search_papers`）检索 web 信息。本 skill 指导你如何构造查询、筛选结果、引用来源。

## 1. 何时用哪个工具

| 需求                                          | 工具                                                          | 说明                                                                      |
| --------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 学术论文（arXiv/PubMed/Semantic Scholar/...） | `paper-search-mcp` 的 `search_papers`                         | 多源去重，返回标准化 Paper dict（title/authors/abstract/doi/year/source） |
| 下载论文 PDF / 读全文                         | `paper-search-mcp` 的 `download_with_fallback` + `read_paper` | OA-first fallback chain（arXiv → PMC → Unpaywall → ...）                  |
| 非学术 web（新闻/教程/数据集主页/观测计划）   | `duckduckgo-mcp` 的 `search`                                  | 免费匿名，无 API key                                                      |
| 抓取网页正文                                  | `duckduckgo-mcp` 的 `fetch_content`                           | 输入 URL，返回清洗后 markdown                                             |

**优先级**：学术问题先 `search_papers`（结构化 + 去重），`duckduckgo-mcp` 仅补非学术信息。

## 2. 查询构造

- **学术**：用物理术语 + 限定词。例：
  - `coronal heating Alfvén wave dissipation phase mixing`（机制 + 物理）
  - `nanoflare Parker solar probe observation`（机制 + 观测）
  - `magnetic reconnection corona X-ray bright points`（机制 + 观测特征）
- **Web**：自然语言问句或关键词。例：
  - `Parker Solar Probe 2024 perihelion results`（最新观测新闻）
  - `SDO AIA data download tutorial`（数据集使用）

**多轮检索策略**：第一轮宽查询（k=5），看结果后窄化（加限定词 / 换同义词）再查。**不要**一次发 10 个并行查询——串行 2-3 轮即可。

## 3. 结果筛选

- **学术**：优先 `source = arXiv`（开放 + 可下载全文）；`year >= 2015`（除非是奠基性老文献）；`abstract` 命中关键词 > title 命中。
- **Web**：title + snippet 命中即取；若需正文细节再 `fetch_content`。
- **去重**：`paper-search-mcp` 已自动去重（DOI / title 相似度），但 web 结果需自己按 URL 去重。

## 4. 引用卫生

- 每条进入假设 rationale 的信息**必须**带来源标识：`[arXiv:2401.12345]` 或 `[web:URL]`。
- 若 `search_papers` 返回 `{papers:[]}`（空），**不要**编造文献——改用 `duckduckgo-mcp` 或直接基于物理先验推理，并在 rationale 注明「无直接文献支持」。
- 下载的 PDF 全文经 `read_paper` 提取后，引用需带页码/章节（若工具返回）。

## 5. 容错

- MCP 工具未配置（`mcpServers` 为空）→ 跳过检索，基于物理先验生成假设，rationale 注明「无外部检索」。
- 工具调用超时 / 返回错误 → 重试 1 次，仍失败则跳过，不阻塞假设生成。
- `fetch_content` 返回乱码 → 站点可能反爬，换 `search` 拿 snippet 即可。
