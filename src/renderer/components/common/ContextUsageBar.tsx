import { formatNumber } from '@shared/utils'

export function ContextUsageBar({ used, limit }: { used: number; limit?: number | null }) {
  if (!limit || limit <= 0) return null
  const percentage = Math.max(0, Math.round((used / limit) * 100))
  const width = Math.min(100, percentage)
  const color = percentage >= 90 ? '#d9485f' : percentage >= 75 ? '#e09143' : '#e68eaa'
  return (
    <div
      className="yachiyo-context-progress"
      role="progressbar"
      aria-label="上下文使用量"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.min(100, percentage)}
      title={`${formatNumber(used)} / ${formatNumber(limit)} tokens (${percentage}%)`}
    >
      <span style={{ width: `${width}%`, backgroundColor: color }} />
    </div>
  )
}
