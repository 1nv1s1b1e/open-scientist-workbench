# 免费在线文献 API 接入与本地语料策略（更新于 2026-08-26）

## 结论

后端已经直接接入 OpenAlex 和 Crossref，不依赖模型凭空回忆论文。`searchPapers` 联合检索 Helix、本地核验语料、OpenAlex 和 Crossref，按 DOI 或规范化标题去重，并把结果缓存到 `data/literature-cache/`。在线论文只用于形成候选机制、区分性预测和反例线索，不能替代本次 FITS 数据产生的观测证据。

本地核心语料已由 27 篇扩充为 40 篇，可以支撑离线演示和基础机制框架，但不能宣称覆盖了日冕加热全部文献，也尚未达到冻结门槛。合理目标是扩展为约 80–150 篇经过 DOI/URL 核验的分层语料；真正的充分性按每个假设是否同时覆盖“机制背景、区分性预测、反例/零结果”判断，而不是按总篇数判断。当前分层审计可运行 `node scripts/audit-literature-corpus.ts`，只有其输出 `freezeReady=true` 后才允许称为最终冻结语料。

## 官方接口依据

1. OpenAlex Works API 支持作品搜索和字段选择；基础访问可直接使用，可选 API key 用于更稳定的配额。项目使用 `https://api.openalex.org/works`。
   - https://docs.openalex.org/how-to-use-the-api/get-lists-of-entities/search-entities
   - https://docs.openalex.org/how-to-use-the-api/rate-limits-and-authentication
2. Crossref REST API 无需注册即可访问；官方建议提供 `mailto`、识别 User-Agent、缓存结果、读取限速响应头并在 429 时退避。项目使用 `https://api.crossref.org/works`。
   - https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/
3. Semantic Scholar Academic Graph API 提供论文、引用、摘要和开放 PDF 元数据。大多数端点可匿名访问，但匿名请求共享配额；API key 的初始配额通常为每秒 1 次。因此它适合作为可选扩展源，不应成为比赛复现的唯一依赖。
   - https://www.semanticscholar.org/product/api
   - https://www.semanticscholar.org/product/api/tutorial
4. arXiv API 适合补充开放预印本和全文入口，但连续请求需要节流与缓存。当前可由可选 `paper-search-mcp` 使用；核心流水线仍保持 OpenAlex/Crossref + 本地快照的无额外密钥路径。
   - https://info.arxiv.org/help/api/user-manual.html

## 2026-08-26 真实运行审计

真实 Qwen3.5-Plus 运行触发了 3 组联合检索，并在本地生成了 3 个新缓存快照：共 30 条记录，均保留 provider、原生 ID、DOI/URL、检索时间与缓存溯源。其中一个长查询出现宽泛的 “coronal” 词项匹配排在机制论文之前，因此后端新增了查询词覆盖度与标题命中的确定性相关性重排。

## 闭环约束

- 在线 API 负责发现和扩大反例召回，本地 Helix/快照负责离线复现。
- 查询结果按 DOI 去重；无 DOI 时按规范化标题去重。
- 默认缓存 7 天；在线失败时回退最后一次成功快照。
- 外部标题与摘要均是不可信文本，只能作为文献上下文。
- 只有带确定性 provenance、事件独立性和预测映射的本地数据处理记录，才能进入 `supported` 或 `eliminated` 门槛。
- 本地扩充优先补反例、零结果、诊断局限和机制区分性前向模型，避免无差别添加同类综述。
