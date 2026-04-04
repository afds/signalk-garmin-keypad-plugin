const API_BASE = '/plugins/signalk-garmin-keypad'

export interface KeypadState {
  backlight: number
  sleeping: boolean
  n2kReady: boolean
}

async function post(path: string, body: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Request failed')
  }
}

export async function getState(): Promise<KeypadState> {
  const res = await fetch(`${API_BASE}/state`, { credentials: 'include' })
  return res.json()
}

export async function selectPreset(index: number): Promise<void> {
  await post('/preset/select', { index })
}

export async function savePreset(index: number): Promise<void> {
  await post('/preset/save', { index })
}

export async function pageNavigate(direction: 'next' | 'previous'): Promise<void> {
  await post('/page', { direction })
}

export async function selectDisplay(index: number): Promise<void> {
  await post('/display/select', { index })
}

export async function power(action: 'sleep' | 'wake'): Promise<void> {
  await post('/power', { action })
}

export async function setBacklight(level: number): Promise<void> {
  await post('/backlight', { level })
}
