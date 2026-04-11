import React, { useState, useEffect, useCallback, useRef } from 'react'
import {
  getState,
  selectPreset,
  savePreset,
  pageNavigate,
  cycleDisplay,
  power,
  setBacklight,
  KeypadState
} from './api'
import './Keypad.css'

const LONG_PRESS_MS = 500

function useLongPress(
  onShortPress: () => void,
  onLongPress: () => void
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressedRef = useRef(false)

  const onPointerDown = useCallback(() => {
    longPressedRef.current = false
    timerRef.current = setTimeout(() => {
      longPressedRef.current = true
      onLongPress()
    }, LONG_PRESS_MS)
  }, [onLongPress])

  const onPointerUp = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!longPressedRef.current) {
      onShortPress()
    }
  }, [onShortPress])

  const onPointerLeave = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  return { onPointerDown, onPointerUp, onPointerLeave }
}

function PresetButton({ index, onSelect, onSave }: {
  index: number
  onSelect: () => void
  onSave: () => void
}) {
  const [isLongPress, setIsLongPress] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handlePointerDown = () => {
    setIsLongPress(false)
    timerRef.current = setTimeout(() => {
      setIsLongPress(true)
      onSave()
    }, LONG_PRESS_MS)
  }

  const handlePointerUp = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (!isLongPress) {
      onSelect()
    }
    setIsLongPress(false)
  }

  const handlePointerLeave = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setIsLongPress(false)
  }

  return (
    <button
      className={`keypad-btn preset-btn ${isLongPress ? 'long-press' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    >
      {index + 1}
    </button>
  )
}

function BacklightControl({ onSet }: {
  onSet: (level: number) => void
}) {
  const levels = [
    { value: 0, label: '100%' },
    { value: 1, label: '50%' },
    { value: 2, label: '0%' }
  ]

  return (
    <div className="control-row backlight-row">
      {levels.map(l => (
        <button
          key={l.value}
          className="keypad-btn backlight-btn"
          onClick={() => onSet(l.value)}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" style={{ marginRight: 4 }}>
            <circle cx="12" cy="12" r="4" fill="currentColor" />
            {l.value < 2 && (
              <>
                <line x1="12" y1="2" x2="12" y2="5" stroke="currentColor" strokeWidth="2" />
                <line x1="12" y1="19" x2="12" y2="22" stroke="currentColor" strokeWidth="2" />
                <line x1="2" y1="12" x2="5" y2="12" stroke="currentColor" strokeWidth="2" />
                <line x1="19" y1="12" x2="22" y2="12" stroke="currentColor" strokeWidth="2" />
              </>
            )}
            {l.value === 0 && (
              <>
                <line x1="4.9" y1="4.9" x2="7.1" y2="7.1" stroke="currentColor" strokeWidth="2" />
                <line x1="16.9" y1="16.9" x2="19.1" y2="19.1" stroke="currentColor" strokeWidth="2" />
                <line x1="19.1" y1="4.9" x2="16.9" y2="7.1" stroke="currentColor" strokeWidth="2" />
                <line x1="7.1" y1="16.9" x2="4.9" y2="19.1" stroke="currentColor" strokeWidth="2" />
              </>
            )}
          </svg>
          {l.label}
        </button>
      ))}
    </div>
  )
}

export function Keypad() {
  const [state, setState] = useState<KeypadState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const showFeedback = (msg: string) => {
    setFeedback(msg)
    setTimeout(() => setFeedback(null), 1000)
  }

  const handleError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    setError(msg)
    setTimeout(() => setError(null), 3000)
  }

  const refreshState = useCallback(async () => {
    try {
      const s = await getState()
      setState(s)
      setError(null)
    } catch (err) {
      handleError(err)
    }
  }, [])

  useEffect(() => {
    refreshState()
    const id = setInterval(refreshState, 5000)
    return () => clearInterval(id)
  }, [refreshState])

  const handleSelectPreset = async (index: number) => {
    try {
      await selectPreset(index)
      showFeedback(`Preset ${index + 1}`)
    } catch (err) {
      handleError(err)
    }
  }

  const handleSavePreset = async (index: number) => {
    try {
      await savePreset(index)
      showFeedback(`Saved preset ${index + 1}`)
    } catch (err) {
      handleError(err)
    }
  }

  const handleDisplayNav = async (direction: 'up' | 'down') => {
    try {
      const result = await cycleDisplay(direction)
      setState(prev => prev ? { ...prev, activeDisplay: result.displayIndex } : prev)
      showFeedback(`Display ${result.displayIndex + 1}`)
    } catch (err) {
      handleError(err)
    }
  }

  const handlePageNav = async (direction: 'next' | 'previous') => {
    try {
      await pageNavigate(direction)
      showFeedback(`Page ${direction}`)
    } catch (err) {
      handleError(err)
    }
  }

  const handlePower = async (action: 'sleep' | 'wake') => {
    try {
      await power(action)
      setState(prev => prev ? { ...prev, sleeping: action === 'sleep' } : prev)
      showFeedback(action === 'sleep' ? 'Sleep' : 'Wake')
    } catch (err) {
      handleError(err)
    }
  }

  const handleBacklight = async (level: number) => {
    try {
      await setBacklight(level)
      showFeedback(['100%', '50%', '0%'][level])
    } catch (err) {
      handleError(err)
    }
  }

  const handlePowerToggle = () => {
    handlePower(state?.sleeping ? 'wake' : 'sleep')
  }

  if (!state) {
    return <div className="keypad-container"><div className="keypad-loading">Loading...</div></div>
  }

  return (
    <div className="keypad-container">
      <div className="keypad-body">
        {/* Status bar */}
        <div className="status-bar">
          <span className="status-label">GNX Keypad</span>
          {!state.handshakeComplete && <span className="status-connecting">Connecting...</span>}
          {feedback && <span className="feedback">{feedback}</span>}
          {error && <span className="error">{error}</span>}
        </div>

        {/* Power button */}
        <div className="power-row">
          <button className="keypad-btn power-btn" onClick={handlePowerToggle}>
            <svg viewBox="0 0 24 24" width="20" height="20">
              <line x1="12" y1="3" x2="12" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path
                d="M6.3 7.7a8 8 0 1 0 11.4 0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Preset buttons 2x2 */}
        <div className="preset-grid">
          {[0, 1, 2, 3].map(i => (
            <PresetButton
              key={i}
              index={i}
              onSelect={() => handleSelectPreset(i)}
              onSave={() => handleSavePreset(i)}
            />
          ))}
        </div>

        {/* Display navigation */}
        <div className="control-row display-row">
          <button className="keypad-btn arrow-btn" onClick={() => handleDisplayNav('up')}>
            <svg viewBox="0 0 24 24" width="25" height="25">
              <path d="M12 8l-6 6h12z" fill="currentColor" />
            </svg>
          </button>
          <div className="row-icon">
            <svg viewBox="0 0 24 24" width="28" height="28">
              <rect x="2" y="3" width="20" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
              <line x1="8" y1="21" x2="16" y2="21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <line x1="12" y1="17" x2="12" y2="21" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
          <button className="keypad-btn arrow-btn" onClick={() => handleDisplayNav('down')}>
            <svg viewBox="0 0 24 24" width="25" height="25">
              <path d="M12 16l6-6H6z" fill="currentColor" />
            </svg>
          </button>
        </div>

        {/* Page navigation */}
        <div className="control-row page-row">
          <button className="keypad-btn arrow-btn" onClick={() => handlePageNav('next')}>
            <svg viewBox="0 0 24 24" width="25" height="25">
              <path d="M12 8l-6 6h12z" fill="currentColor" />
            </svg>
          </button>
          <div className="row-icon">
            <svg viewBox="0 0 24 24" width="28" height="28">
              <path
                d="M6 2h9l5 5v15H6z"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <path d="M15 2v5h5" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
          <button className="keypad-btn arrow-btn" onClick={() => handlePageNav('previous')}>
            <svg viewBox="0 0 24 24" width="25" height="25">
              <path d="M12 16l6-6H6z" fill="currentColor" />
            </svg>
          </button>
        </div>

        {/* Backlight control */}
        <BacklightControl
          onSet={handleBacklight}
        />
      </div>
    </div>
  )
}
