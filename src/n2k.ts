import {
  CMD_SELECT_PRESET,
  CMD_SAVE_PRESET,
  CMD_PAGE_NAV,
  CMD_DEVICE_HANDSHAKE,
  CMD_DEVICE_IDENT,
  PRODUCT_ID,
  UNK1,
  UNK2,
  PROPERTY_SEPARATOR,
  PGN_SINGLE,
  PGN_FAST,
  DEFAULT_SRC,
  DEFAULT_DST,
  DEFAULT_PRIO,
  PROP_SLEEP,
  PROP_DISPLAY,
  SLEEP,
  WAKE,
  DEFAULT_GROUP_ID,
  buildPropertyHeader,
  buildHeartbeatHeader,
  buildDeviceIdentPayload
} from './protocol'

export interface PgnMessage {
  pgn: number
  dst: number
  prio: number
  src: number
  [key: string]: any
}

// Module-level group ID — set once at plugin start via setGroupId().
// Defaults to the factory group ID found in captures; updated via config or auto-discovery.
let currentGroupId: Buffer = DEFAULT_GROUP_ID

export function setGroupId(groupId: Buffer): void {
  currentGroupId = groupId
}

// Extracts the group ID from a PGN 126720 Payload buffer (either 0xe5 or 0xe7 message).
// The group ID is at payload bytes 7-10 in both message types.
// Returns null if the buffer is too short or the bytes are all zeros.
export function extractGroupIdFromPayload(payload: Buffer | null): Buffer | null {
  if (!payload || !Buffer.isBuffer(payload) || payload.length < 11) return null
  const id = payload.slice(7, 11)
  if (id.every(b => b === 0)) return null
  return id
}

// --- PGN 61184 builders (field-based, encoded by canboatjs) ---

function buildButtonPgn(
  command: number,
  paramName: string,
  paramValue: number,
  src: number
): PgnMessage {
  return {
    pgn: PGN_SINGLE,
    dst: DEFAULT_DST,
    prio: DEFAULT_PRIO,
    src,
    'Manufacturer Code': 229,
    'Industry Code': 4,
    'Command': command,
    'Product ID': PRODUCT_ID,
    'Unknown 1': UNK1,
    'Unknown 2': UNK2,
    [paramName]: paramValue
  }
}

export function buildSelectPreset(index: number, src: number = DEFAULT_SRC): PgnMessage {
  if (!Number.isInteger(index) || index < 0 || index > 3) {
    throw new Error(`Preset index must be 0-3, got ${index}`)
  }
  return buildButtonPgn(CMD_SELECT_PRESET, 'Preset Index', index, src)
}

export function buildSavePreset(index: number, src: number = DEFAULT_SRC): PgnMessage {
  if (!Number.isInteger(index) || index < 0 || index > 3) {
    throw new Error(`Preset index must be 0-3, got ${index}`)
  }
  return buildButtonPgn(CMD_SAVE_PRESET, 'Preset Index', index, src)
}

export function buildPageNav(direction: 'next' | 'previous', src: number = DEFAULT_SRC): PgnMessage {
  const param = direction === 'next' ? 0 : 1
  return buildButtonPgn(CMD_PAGE_NAV, 'Direction', param, src)
}

// --- PGN 126720 builders (payload as pre-built Buffer) ---

// Per-property sequence counters (mimics real keypad behavior).
// Each property name maintains its own independent counter.
// Counter space is 10-bit (0-1023), wrapping at 1024.
// Bytes 5-6 encode counter C as: byte5 = 0x8e + (C & 7) * 0x10, byte6 = C >> 3.
// T6 must stay in 0x00-0x7f range (max counter 1023); displays silently
// reject messages with T6 >= 0x80.
const propertyCounters = new Map<string, number>()
const MAX_SEQ = 0x3FF  // 1023 — maximum valid counter value

export function resetCounters(): void {
  propertyCounters.clear()
}

// Decode a counter value from trailing bytes T5, T6.
export function decodeCounter(t5: number, t6: number): number {
  return (t6 << 3) | ((t5 - 0x8e) >> 4)
}

// Set the counter for a property to match a discovered stored value.
// The next buildTrailing call will send (stored + 1) & MAX_SEQ.
export function ensureCounterAbove(property: string, minSeq: number): void {
  const current = propertyCounters.get(property) ?? -1
  const clamped = minSeq & MAX_SEQ
  if (current < clamped) {
    propertyCounters.set(property, clamped)
  }
}

// Keypad fingerprint bytes — must match the fingerprint stored on the GNX
// displays for the property being set.  Displays persist the fingerprint of
// the last keypad that successfully changed each property and reject commands
// from a different fingerprint.  Default is a real GNX Keypad's fingerprint
// extracted from captured bus traffic.
let keypadFingerprint: [number, number] = [0xf9, 0xa9]

export function setFingerprint(fp: [number, number]): void {
  keypadFingerprint = fp
}

function buildTrailing(property: string): Buffer {
  const prev = propertyCounters.get(property) ?? -1
  const seq = (prev + 1) & MAX_SEQ
  propertyCounters.set(property, seq)
  const buf = Buffer.alloc(7)
  buf[0] = 0x2e
  buf[1] = 0x80 | (Math.random() * 128 | 0)  // T1: random nonce, bit 7 must be set or displays reject
  buf[2] = 0xb0         // T2: 1-bit state flag — 0xb0 is safe constant
  buf[3] = keypadFingerprint[0]  // T3: keypad fingerprint byte 1
  buf[4] = keypadFingerprint[1]  // T4: keypad fingerprint byte 2
  buf[5] = 0x8e + (seq & 7) * 0x10  // T5: counter low bits
  buf[6] = (seq >> 3) & 0x7f         // T6: counter high bits (must be 0x00-0x7f)
  return buf
}

function buildPropertyPayload(property: string, value: number): Buffer {
  const strLen = property.length + 1
  const strBuf = Buffer.from(property + '\0', 'ascii')
  const valueBuf = Buffer.from([value])

  // Skip first byte of header (command byte 0xe5) — canboatjs writes it from PGN Match
  return Buffer.concat([
    buildPropertyHeader(currentGroupId).slice(1),
    Buffer.from([strLen]),
    strBuf,
    PROPERTY_SEPARATOR,
    valueBuf,
    buildTrailing(property)
  ])
}

function buildPropertyPgn(property: string, value: number, src: number): PgnMessage {
  return {
    pgn: PGN_FAST,
    dst: DEFAULT_DST,
    prio: DEFAULT_PRIO,
    src,
    'Manufacturer Code': 229,
    'Industry Code': 4,
    'Command': 0xe5,
    'Payload': buildPropertyPayload(property, value)
  }
}

export function buildSleepWake(sleep: boolean, src: number = DEFAULT_SRC): PgnMessage {
  return buildPropertyPgn(PROP_SLEEP, sleep ? SLEEP : WAKE, src)
}

export function buildDisplaySelect(index: number, src: number = DEFAULT_SRC): PgnMessage {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Display index must be a non-negative integer, got ${index}`)
  }
  return buildPropertyPgn(PROP_DISPLAY, index, src)
}

export function buildHeartbeat(src: number = DEFAULT_SRC): PgnMessage {
  // Skip first byte of header (command byte 0xe7) — canboatjs writes it from PGN Match
  const payload = Buffer.concat([
    buildHeartbeatHeader(currentGroupId).slice(1),
    Buffer.from([0x00])
  ])

  return {
    pgn: PGN_FAST,
    dst: DEFAULT_DST,
    prio: DEFAULT_PRIO,
    src,
    'Manufacturer Code': 229,
    'Industry Code': 4,
    'Command': 0xe7,
    'Payload': payload
  }
}

// --- Startup handshake builders ---

export function buildDeviceIdent(src: number = DEFAULT_SRC, dst: number = DEFAULT_DST): PgnMessage {
  return {
    pgn: PGN_FAST,
    dst,
    prio: DEFAULT_PRIO,
    src,
    'Manufacturer Code': 229,
    'Industry Code': 4,
    'Command': CMD_DEVICE_IDENT,
    'Payload': buildDeviceIdentPayload()
  }
}

export function buildDeviceHandshake(src: number = DEFAULT_SRC, dst: number = DEFAULT_DST): PgnMessage {
  return {
    pgn: PGN_SINGLE,
    dst,
    prio: DEFAULT_PRIO,
    src,
    'Manufacturer Code': 229,
    'Industry Code': 4,
    'Command': CMD_DEVICE_HANDSHAKE,
    'Unknown 1': 0x00,
    'Unknown 2': 0x02,
    'Unknown 3': 0x02,
    'Unknown 4': 0xa4,
    'Unknown 5': 0x00
  }
}

// --- ISO Request (PGN 59904) ---
// Sends a standard NMEA 2000 ISO Request to trigger mutual discovery.
// The real keypad requests PGN 60928 (Address Claim) from each display
// during startup. Displays do NOT validate Product Code from PGN 126996 —
// tested with a generic ESP32 gateway (non-Garmin identity) and handshake
// completes successfully.

export function buildIsoRequest(requestedPgn: number, src: number = DEFAULT_SRC, dst: number = DEFAULT_DST): PgnMessage {
  return {
    pgn: 59904,
    dst,
    prio: 6,
    src,
    'PGN': requestedPgn
  }
}

