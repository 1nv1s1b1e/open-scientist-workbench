import type { McpServerConfig } from '@open-scientist/schema'

/**
 * 预配 MCP server 清单 —— 推荐的第三方 MCP server 配置，供 agent per-role 挂载。
 *
 * 这些 server 不由 open-scientist 自己启动，而是通过 `stdio` 或 `http`
 * transport 连接到本机或远程已运行的 MCP server。用户通过
 * `PUT /api/settings/agents/:role` 的 `mcpServers` 字段选择启用。
 *
 * 每条 preset 的 `name` 是稳定标识，`McpServerConfig` 其余字段是启动参数。
 * stdio 类需要本机安装对应命令（uvx / uv / npx）；http 类直连远程 URL。
 *
 * 来源（2026-07 调研）：
 * - paper-search-mcp: https://github.com/openags/paper-search-mcp (2.2k★, MIT)
 *   多源学术检索（arXiv/PubMed/bioRxiv/Semantic Scholar/Crossref/OpenAlex/Zenodo/...）
 *   免费优先，可选 API key 提升配额。推荐 Librarian。
 * - duckduckgo-mcp: https://github.com/nickclyde/duckduckgo-mcp-server
 *   免费匿名 web 搜索（DuckDuckGo），无 API key。推荐 Librarian 补充非学术信息。
 * - arxiv-mcp-server: https://github.com/blazickjp/arxiv-mcp-server
 *   arXiv 专用（search + download + read），比 paper-search-mcp 更专注但覆盖窄。
 *
 * 安装前置（macOS）：
 *   curl -LsSf https://astral.sh/uv/install.sh | sh   # uv / uvx
 *   # 或 npm i -g npx（已随 Node 自带）
 */
export const MCP_PRESETS: Record<
  string,
  McpServerConfig & { description: string; recommendedFor: string[] }
> = {
  /**
   * 多源学术检索（arXiv + PubMed + bioRxiv + Semantic Scholar + Crossref +
   * OpenAlex + Zenodo + HAL + ...）。免费优先，可选 API key。
   *
   * 推荐角色：Librarian（文献 RAG 主力）。
   * 依赖：uvx（`curl -LsSf https://astral.sh/uv/install.sh | sh`）
   * 可选 env：PAPER_SEARCH_MCP_UNPAYWALL_EMAIL / PAPER_SEARCH_MCP_CORE_API_KEY /
   *   PAPER_SEARCH_MCP_SEMANTIC_SCHOLAR_API_KEY（见 .env.example）
   */
  'paper-search-mcp': {
    name: 'paper-search-mcp',
    transport: 'stdio',
    command: 'uvx',
    args: ['paper-search-mcp'],
    description:
      '多源学术检索（arXiv/PubMed/bioRxiv/Semantic Scholar/Crossref/OpenAlex/Zenodo 等 20+ 源）。免费优先，可选 API key 提升配额。工具：search_papers / download_with_fallback / read_paper。',
    recommendedFor: ['librarian'],
  },

  /**
   * 免费匿名 web 搜索（DuckDuckGo Instant Answer + Lite HTML）。
   * 无 API key，无追踪。适合补充非学术信息（新闻、教程、数据集主页等）。
   *
   * 推荐角色：Librarian（补充 web 检索）、Prometheus（规划时查最新观测计划）。
   * 依赖：uvx 或 npx
   */
  'duckduckgo-mcp': {
    name: 'duckduckgo-mcp',
    transport: 'stdio',
    command: 'uvx',
    args: ['duckduckgo-mcp-server'],
    description:
      '免费匿名 web 搜索（DuckDuckGo，无 API key）。工具：search / fetch_content。适合补充非学术信息。',
    recommendedFor: ['librarian', 'prometheus'],
  },

  /**
   * arXiv 专用 MCP（search + download + read + deep research prompts）。
   * 比 paper-search-mcp 更专注 arXiv，但覆盖窄。
   *
   * 推荐角色：Librarian（若只需 arXiv，比多源更轻）。
   * 依赖：uvx
   */
  'arxiv-mcp': {
    name: 'arxiv-mcp',
    transport: 'stdio',
    command: 'uvx',
    args: ['arxiv-mcp-server'],
    description:
      'arXiv 专用检索 + 下载 + 全文读取 + 深度研究 prompt。工具：search_papers / download_paper / read_paper / list_papers。',
    recommendedFor: ['librarian'],
  },
}

/**
 * 按 agent role 拿推荐的 preset name 列表（基于 preset 的 recommendedFor）。
 * 调用方用它构造 DEFAULT_GLOBAL.agents[role].mcpServers。
 */
export function getRecommendedPresetsForRole(role: string): McpServerConfig[] {
  return Object.values(MCP_PRESETS)
    .filter((p) => p.recommendedFor.includes(role))
    .map(({ description: _d, recommendedFor: _r, ...config }) => config)
}
