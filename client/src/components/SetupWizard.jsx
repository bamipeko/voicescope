import { useState, useEffect } from 'react'
import { useAppStore } from '../stores/appStore'

const isElectron = !!window.electronAPI?.isElectron

const STEPS = [
  {
    key: 'DEEPGRAM_API_KEY',
    label: 'Deepgram',
    description: '文字起こしに使用します（メインエンジン）',
    required: true,
    helpUrl: 'https://console.deepgram.com/',
  },
  {
    key: 'GEMINI_API_KEY',
    label: 'Gemini (Google)',
    description: '要約生成に使用します（デフォルトLLM）',
    required: true,
    helpUrl: 'https://aistudio.google.com/apikey',
  },
  {
    key: 'OPENAI_API_KEY',
    label: 'OpenAI',
    description: 'Whisper文字起こし / GPT要約に使用（任意）',
    required: false,
    helpUrl: 'https://platform.openai.com/api-keys',
  },
  {
    key: 'GROK_API_KEY',
    label: 'Grok (xAI)',
    description: 'Grok要約に使用（任意）',
    required: false,
    helpUrl: 'https://console.x.ai/',
  },
]

export default function SetupWizard({ onComplete }) {
  const [step, setStep] = useState(0)
  const [keys, setKeys] = useState({})
  const [checking, setChecking] = useState(true)
  const [visible, setVisible] = useState(false)
  const addToast = useAppStore((s) => s.addToast)

  // Check if setup is needed
  useEffect(() => {
    if (!isElectron) {
      setChecking(false)
      return
    }

    const checkKeys = async () => {
      const deepgram = await window.electronAPI.storeGet('DEEPGRAM_API_KEY')
      const gemini = await window.electronAPI.storeGet('GEMINI_API_KEY')

      // Show wizard if required keys are missing
      if (!deepgram || !gemini) {
        setVisible(true)
      }
      setChecking(false)
    }
    checkKeys()
  }, [])

  const handleSave = async () => {
    // Save all entered keys
    let savedCount = 0
    for (const [key, value] of Object.entries(keys)) {
      if (value?.trim()) {
        await window.electronAPI.storeSet(key, value.trim())
        savedCount++
      }
    }

    if (savedCount > 0) {
      addToast(`${savedCount}件のAPIキーを保存しました。再起動後に反映されます。`, 'success')
    }

    setVisible(false)
    if (onComplete) onComplete()
  }

  const handleSkip = () => {
    setVisible(false)
    if (onComplete) onComplete()
  }

  const currentStep = STEPS[step]

  if (checking || !visible) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl max-w-lg w-full p-8 shadow-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🎙️</div>
          <h1 className="text-2xl font-bold text-white">VoiceScope セットアップ</h1>
          <p className="text-sm text-gray-400 mt-2">
            APIキーを設定してください（後から設定画面でも変更できます）
          </p>
        </div>

        {/* Progress */}
        <div className="flex gap-1 mb-6">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded ${
                i <= step ? 'bg-blue-500' : 'bg-gray-700'
              }`}
            />
          ))}
        </div>

        {/* Current step */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-white">
              {currentStep.label}
              {currentStep.required && <span className="text-red-400 ml-1">*</span>}
            </label>
            <a
              href={currentStep.helpUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              キー取得はこちら →
            </a>
          </div>
          <p className="text-xs text-gray-500 mb-2">{currentStep.description}</p>
          <input
            type="password"
            value={keys[currentStep.key] || ''}
            onChange={(e) => setKeys((k) => ({ ...k, [currentStep.key]: e.target.value }))}
            placeholder={`${currentStep.label} APIキーを入力...`}
            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            autoFocus
          />
        </div>

        {/* Navigation */}
        <div className="flex items-center justify-between">
          <div>
            {step > 0 && (
              <button
                onClick={() => setStep(step - 1)}
                className="text-sm text-gray-400 hover:text-white"
              >
                ← 戻る
              </button>
            )}
          </div>
          <div className="flex gap-3">
            {!currentStep.required && (
              <button
                onClick={() => {
                  if (step < STEPS.length - 1) {
                    setStep(step + 1)
                  } else {
                    handleSave()
                  }
                }}
                className="text-sm text-gray-400 hover:text-white"
              >
                スキップ
              </button>
            )}
            <button
              onClick={() => {
                if (step < STEPS.length - 1) {
                  setStep(step + 1)
                } else {
                  handleSave()
                }
              }}
              disabled={currentStep.required && !keys[currentStep.key]?.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white px-6 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {step < STEPS.length - 1 ? '次へ' : '完了'}
            </button>
          </div>
        </div>

        {/* Skip all */}
        <div className="text-center mt-4">
          <button
            onClick={handleSkip}
            className="text-xs text-gray-600 hover:text-gray-400"
          >
            セットアップをスキップ（後で設定画面から設定）
          </button>
        </div>
      </div>
    </div>
  )
}
