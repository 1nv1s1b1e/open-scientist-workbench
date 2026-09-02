# Open Scientist 细粒度分析素材包

素材来自 `fine-grained-analysis-flowchart-v3.png` 的语义拆分，便于在网页、PPT 或后续流程图中复用。

## 文件

- `icons.svg`：可复用 SVG 图标 sprite。每个图标使用 `<symbol id="...">` 定义，线条颜色继承 `currentColor`。
- `observations/`：从流程图 Stage 1 的多模态观测缩略图中裁出的 PNG 图片。

## 使用图标

```html
<svg width="48" height="48" viewBox="0 0 64 64" style="color:#123d7a">
  <use href="icons.svg#target" />
</svg>
```

可用图标 ID：

`abnormal`, `trend`, `target`, `fits`, `mp4`, `time-alignment`, `channel-registration`, `roi`, `layers`, `wave`, `grid`, `cross-channel`, `target-window`, `multichannel`, `search`, `compare`, `evidence`, `library`, `physical-channels`, `explore`, `shield`, `bulb`, `prediction`, `oracle`, `prometheus`, `next-task`, `telescope`
