const STATUS_MAP = {
  uploaded: { label: 'アップロード済', color: 'bg-gray-600' },
  transcribing: { label: '文字起こし中', color: 'bg-yellow-600 animate-pulse' },
  transcribed: { label: '文字起こし完了', color: 'bg-blue-600' },
  summarizing: { label: '要約中', color: 'bg-yellow-600 animate-pulse' },
  completed: { label: '完了', color: 'bg-green-600' },
  error: { label: 'エラー', color: 'bg-red-600' },
}

export default function StatusBadge({ status }) {
  const info = STATUS_MAP[status] || { label: status, color: 'bg-gray-600' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white ${info.color}`}>
      {info.label}
    </span>
  )
}
