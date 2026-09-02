param(
  [string]$OutputDir = "$PSScriptRoot\render-current\narration"
)

Add-Type -AssemblyName System.Speech
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$segments = @(
  '太阳光球层的温度大约是五千八百开尔文，而上方日冕却达到一到三百万开尔文。为什么离开太阳表面之后，温度反而重新升高？这就是日冕加热的未解之谜。',
  '面对同一组观测，可能有不同的物理解释。阿尔芬波可以传播并耗散，磁重联可以通过纳耀斑脉冲释放能量，也可能是两种机制在不同尺度上耦合。',
  '所以科学推理不能从现象直接跳到答案。我们需要把现象、证据、假设、检验和结论连接起来，并在每一步保留来源、不确定性和可修正的边界。',
  'Open Scientist 的目标，是把这个研究过程变成一个可追踪的工作流。用户输入一个开放现象，系统组织文献、观测、计算和反例，最后输出下一步可执行的科学方案。',
  '一次运行经过四个阶段。A 定义问题，B 构建证据，C 组织推理并主动反驳，D 把结果交付为配置和观测提案。每一步都能回放、追踪，也能在失败后继续修正。',
  '六个 agent 共同组成一条回路。Sisyphus 负责统筹，Librarian 建立假设空间，Looker 在有图像或视频证据时完成观测对齐，Explore 做可复现计算，Oracle 寻找反例，Prometheus 把推理变成下一轮方案。',
  'Sisyphus 是确定性的编排器。它解析任务，安排研究轮次，记录事件和状态，并在证据发生变化时，把结果送回正确的下一步。',
  'Librarian 从文献和已有知识中提取机制，形成候选假设，同时标出每个假设的预测、支持证据和仍然缺失的观测。',
  '当任务带有 FITS 或 MP4 证据时，Looker 对齐时间、通道和感兴趣区域，把多模态观测整理成带来源和不确定性的可计算对象。',
  'Explore 把假设翻译成计算任务，批量扫描快照，测量 EUV 和软 X 射线的时序关系、传播和滞后，并保留代码、参数与结果轨迹。',
  'Oracle 不只问一个假设能否解释现象，还主动寻找会让它失败的反例，识别混淆因素，并在必要时修改、淘汰或重组假设。',
  'Prometheus 综合当前证据，把最可信的解释和剩余不确定性转化为 MHD 参数、观测优先级和下一轮验证任务。',
  '现在看一个例子。我们把活动区 AR 一三六六四的现象输入系统：局部亮度突增，EUV 领先软 X 射线，部分环结构又不同步升温。',
  '系统不会把单一信号直接当成证明。EUV 领先只提示局部释放或热传递，而持续升温却没有明显脉冲，因此支持、未知和矛盾会同时进入证据账本。',
  '随后，反例改变假设权重，新的验证任务由证据缺口驱动生长。系统继续追问：还需要什么计算和观测，才能真正区分波动耗散、纳耀斑和它们的耦合？',
  '最终交付的不是一句确定答案，而是一份带边界的方案：假设排序、证据来源、未知项、可复现的 MHD 配置，以及下一步观测提案。',
  'Open Scientist 的意义，不是让机器替人宣布真理，而是让复杂研究变得开放、可复现、可协作，并让每一个结论都通向下一次检验。'
)

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice('Microsoft Huihui Desktop')
$synth.Rate = 0
$synth.Volume = 100

try {
  for ($i = 0; $i -lt $segments.Count; $i++) {
    $path = Join-Path $OutputDir ("segment-{0:00}.wav" -f ($i + 1))
    $synth.SetOutputToWaveFile($path)
    $synth.Speak($segments[$i])
    $synth.SetOutputToNull()
  }
} finally {
  $synth.Dispose()
}

Write-Output "Generated $($segments.Count) narration segments in $OutputDir"
