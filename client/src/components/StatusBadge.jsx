const STATUS_MAP = {
  uploaded: { label: 'アップロード済', color: 'bg-gray-500/30 text-gray-300' },
  transcribing: { label: '文字起こし中', color: 'bg-yellow-500/25 text-yellow-300 animate-pulse' },
  transcribed: { label: '文字起こし完了', color: 'bg-blue-500/25 text-blue-300' },
  refining: { label: '整形中', color: 'bg-purple-500/25 text-purple-300 animate-pulse' },
  summarizing: { label: '要約中', color: 'bg-yellow-500/25 text-yellow-300 animate-pulse' },
  completed: { label: '完了', color: 'bg-green-500/20 text-green-400' },
  error: { label: 'エラー', color: 'bg-red-500/25 text-red-300' },
}

export default function StatusBadge({ status }) {
  const info = STATUS_MAP[status] || { label: status, color: 'bg-gray-500/30 text-gray-300' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${info.color}`}>
      {info.label}
    </span>
  )
}
