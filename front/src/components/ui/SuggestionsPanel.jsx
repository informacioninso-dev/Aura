import { useEffect, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Lightbulb } from 'lucide-react'

export default function SuggestionsPanel({
  title = 'Sugerencias',
  initiallyOpen = false,
  tone = 'default',
  items = [],
}) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [open, setOpen] = useState(initiallyOpen)

  useEffect(() => {
    setCurrentIndex((index) => Math.min(index, Math.max(items.length - 1, 0)))
  }, [items.length])

  if (!items.length) return null

  const currentItem = items[Math.min(currentIndex, items.length - 1)]
  const paletteClass = tone === 'warning' ? 'suggestions-panel is-warning' : 'suggestions-panel'

  function handlePrimaryAction() {
    currentItem.onPrimaryAction?.()
  }

  function handleSecondaryAction() {
    if (currentItem.onSecondaryAction) currentItem.onSecondaryAction()
    else setOpen(false)
  }

  function goPrev() {
    setCurrentIndex((index) => Math.max(0, index - 1))
  }

  function goNext() {
    setCurrentIndex((index) => Math.min(items.length - 1, index + 1))
  }

  return (
    <section className={paletteClass}>
      <button
        type="button"
        className={`suggestions-panel-toggle ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((value) => !value)}
      >
        <div className="suggestions-panel-toggle-copy">
          <span className="suggestions-panel-kicker">
            <Lightbulb size={14} />
            {title} ({items.length})
          </span>
          <span className="suggestions-panel-summary">{currentItem.summary}</span>
        </div>
        <ChevronDown size={18} className="suggestions-panel-toggle-icon" />
      </button>

      {open && (
        <div className="suggestions-panel-body">
          <div className="suggestions-panel-card">
            <div className="suggestions-panel-card-copy">
              <span className="suggestions-panel-card-title">{currentItem.title}</span>
              <p className="suggestions-panel-card-text">{currentItem.description}</p>
            </div>

            <div className="suggestions-panel-actions">
              {currentItem.primaryActionLabel && (
                <button
                  type="button"
                  className={currentItem.primaryButtonClass || 'btn-modal-convert'}
                  onClick={handlePrimaryAction}
                  disabled={currentItem.primaryDisabled}
                >
                  {currentItem.primaryActionLabel}
                </button>
              )}
              {currentItem.secondaryActionLabel !== null && (
                <button
                  type="button"
                  className={currentItem.secondaryButtonClass || 'btn-modal-cancel'}
                  onClick={handleSecondaryAction}
                  disabled={currentItem.secondaryDisabled}
                >
                  {currentItem.secondaryActionLabel || 'Ahora no'}
                </button>
              )}
            </div>
          </div>

          {items.length > 1 && (
            <div className="suggestions-panel-nav">
              <button
                type="button"
                className="suggestions-panel-nav-btn"
                onClick={goPrev}
                disabled={currentIndex <= 0}
                aria-label="Sugerencia anterior"
              >
                <ChevronLeft size={15} />
              </button>
              <span className="suggestions-panel-nav-label">
                {currentIndex + 1} de {items.length}
              </span>
              <button
                type="button"
                className="suggestions-panel-nav-btn"
                onClick={goNext}
                disabled={currentIndex >= items.length - 1}
                aria-label="Siguiente sugerencia"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}