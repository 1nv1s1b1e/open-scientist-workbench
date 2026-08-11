/** Keep operational details in the run log while the workspace states the
 * scientific consequence in language a researcher can act on. */
export function formatCorrectionMessage(message: string | undefined): string {
  const value = message?.trim()
  if (!value) return '已重新核验事实边界。'
  if (/(helix|cannot reach|fetch failed|connection refused|econnrefused)/i.test(value)) {
    return '资料检索暂时不可用，相关结论保留为未知；服务恢复后需要重新核验。'
  }
  if (/(timeout|timed out|超时)/i.test(value)) {
    return '相关资料处理超时，尚未获得可复核结果；该部分保留为未知。'
  }
  if (/(not found|missing|未找到|缺失)/i.test(value)) {
    return '未找到可复核的相关资料；需要补充数据或来源后再判断。'
  }
  return value
}

export function describeTerminationReason(reason: string | null): string | null {
  if (!reason) return null
  if (reason === 'demo_preview') return '示例预览'
  if (reason === 'max_rounds_reached') return '已达到设置的最大轮次'
  if (reason === 'converged') return '本轮结果已收敛'
  if (reason === 'blocked') return '等待补充资料'
  if (reason === 'failed') return '本轮需要处理'
  if (reason === 'completed') return '本轮完成'
  return '本轮已结束'
}
