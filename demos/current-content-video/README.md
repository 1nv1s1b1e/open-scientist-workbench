# 当前内容 HyperFrames Video Demo

这是一个基于 [HeyGen HyperFrames](https://github.com/heygen-com/hyperframes) 的 175 秒无声视频 Demo。v3 版将原来的 15 个叙事章节拆成 24 个紧凑页面节拍，让框架、节点、证据和路由在页面之间连续推进，而不是停留在单张图片展示。

视频从真实运行结果生成，当前数据包括：

- 2 轮执行，14 条 agent execution 记录（13 completed、1 skipped）
- 3 个候选假设，状态为 candidate / uncertain / candidate
- 32 条证据：2 support、30 unknown、0 contradict
- 23 条校正记录，12 个验证任务（3 completed、9 planned）
- 最终状态为 needs_data，终止原因是 max_rounds_reached

## 这版改了什么

- 原 15 个分镜章节保留，实施层拆成 24 个页面，每页约 6–7 秒
- 左侧流程轨道持续显示 OBSERVE → STRUCTURE → HYPOTHESES → EVIDENCE → VALIDATE → TRACE
- 页面之间使用持续 trace cursor、顶部 wipe 转场和左右交替的内容入场，避免页面像静态幻灯片一样硬切
- 页面内加入真实执行动画：API 数据包进入 checkpoint、LangGraph 数据包穿过 A/B/C/D、B.dispatch 分发到 worker、FITS/产物扫描、evidence ledger 生成和 D.route 分支脉冲
- Round、gate、correction、handoff 列表采用逐行展开，数值采用 count-up，最终 close map 用数据包沿路径回流到 OBSERVE
- B.dispatch、B.worker、B.aggregate、BC.verify、C.verify、D.plan、D.route 都以真实节点名出现
- 数据仍然从 scientific-result.json 派生生成，不在 HTML 中虚构运行结果

## 分镜

完整叙事分镜在 [storyboard.md](./storyboard.md)，共 15 个章节；其中 v3 的 24 个页面节拍用于把每个章节拆成更紧凑的结构转场。

## 渲染

要求 Node.js 22+、FFmpeg 和可用的 Chrome/Chromium。请在 open-scientist 项目根目录运行：

~~~powershell
node .\demos\current-content-video\render-demo.mjs
~~~

默认读取：

~~~text
outputs/ar11158-qwen-demo/scientific-result.json
~~~

默认输出：

~~~text
demos/current-content-video/open-scientist-hyperframes-demo-v3.mp4
~~~

脚本会先根据 JSON 生成 data.js，再调用 HyperFrames 的原生 render --composition hyperframes-compact.html --strict 逐帧渲染。旧的 hyperframes.html 和 index.html 均保留，便于对照。

也可以指定输入结果和输出文件：

~~~powershell
$env:SCIENTIFIC_RESULT_PATH = 'C:\path\to\scientific-result.json'
node .\demos\current-content-video\render-demo.mjs C:\path\to\demo.mp4
~~~

## 当前素材

- 视频：[open-scientist-hyperframes-demo-v3.mp4](./open-scientist-hyperframes-demo-v3.mp4)
- 紧凑版 composition：[hyperframes-compact.html](./hyperframes-compact.html)
- 原始分镜：[storyboard.md](./storyboard.md)
- 页面抽检：[hyperframes-v3-contact-sheet.png](./hyperframes-v3-contact-sheet.png)
- 动画关键帧抽检：[qa-animated/animated-contact-sheet.png](./qa-animated/animated-contact-sheet.png)
- 首帧海报：[hyperframes-v3-poster.png](./hyperframes-v3-poster.png)
- 当前结果：[scientific-result.json](../../outputs/ar11158-qwen-demo/scientific-result.json)

这版仍然是无声 Demo，字幕、节点、计数和结构转场承担叙事；后续可以在不改变页面时间轴的前提下接入中文旁白、字幕强化和音效。
