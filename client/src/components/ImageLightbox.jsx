import { useEffect } from 'react'

/**
 * Modal lightbox for viewing a generated infographic at full size.
 *
 * Props:
 *   url       — image source URL (must be ready, no async resolution here)
 *   alt       — alt text for the <img>
 *   onClose   — called when user clicks backdrop, X button, or presses Esc
 *   actions   — optional array of { label, onClick, variant? } rendered as
 *               buttons below the image (for ↓ DL / 📁 場所 / 📋 コピー etc.)
 *
 * Background-click and Esc both close. Image area stops propagation so
 * clicking the image itself doesn't close the modal.
 */
export default function ImageLightbox({ url, alt, onClose, actions = [] }) {
  // Allow Esc to close — common UX expectation for lightboxes.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!url) return null

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/85 flex items-center justify-center p-6 overflow-auto"
      onClick={onClose}
    >
      <div
        className="relative flex flex-col items-center gap-3 max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button — top right of the modal viewport */}
        <button
          onClick={onClose}
          className="absolute -top-2 -right-2 w-8 h-8 bg-card border border-theme-light rounded-full text-gray-300 hover:text-white hover:bg-gray-800 flex items-center justify-center text-lg z-10"
          title="閉じる (Esc)"
        >
          ✕
        </button>

        {/* The image itself — capped to viewport so it scales down on small windows */}
        <img
          src={url}
          alt={alt}
          className="max-w-[90vw] max-h-[80vh] rounded shadow-2xl"
        />

        {/* Action bar — DL / 場所 / コピー etc. */}
        {actions.length > 0 && (
          <div className="flex gap-2 flex-wrap justify-center">
            {actions.map((a, i) => (
              <button
                key={i}
                onClick={a.onClick}
                className={
                  a.variant === 'primary'
                    ? 'px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm'
                    : 'px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded text-sm'
                }
                title={a.title}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}

        <p className="text-[11px] text-gray-500">クリックで閉じる / Esc キーでも閉じます</p>
      </div>
    </div>
  )
}
