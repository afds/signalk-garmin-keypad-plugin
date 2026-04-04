import {
  CMD_SELECT_PRESET,
  CMD_SAVE_PRESET,
  CMD_PAGE_NAV,
  PRODUCT_ID,
  UNK1,
  UNK2,
  PROPERTY_HEADER,
  PROPERTY_SEPARATOR,
  HEARTBEAT_HEADER,
  PGN_SINGLE,
  PGN_FAST,
  DEFAULT_SRC,
  DEFAULT_DST,
  DEFAULT_PRIO,
  PROP_SLEEP,
  PROP_INTENSITY,
  PROP_DISPLAY,
  SLEEP,
  WAKE
} from './protocol'

export interface PgnMessage {
  pgn: number
  dst: number
  prio: number
  src: number
  [key: string]: any
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
  if (index < 0 || index > 3) {
    throw new Error(`Preset index must be 0-3, got ${index}`)
  }
  return buildButtonPgn(CMD_SELECT_PRESET, 'Preset Index', index, src)
}

export function buildSavePreset(index: number, src: number = DEFAULT_SRC): PgnMessage {
  if (index < 0 || index > 3) {
    throw new Error(`Preset index must be 0-3, got ${index}`)
  }
  return buildButtonPgn(CMD_SAVE_PRESET, 'Preset Index', index, src)
}

export function buildPageNav(direction: 'next' | 'previous', src: number = DEFAULT_SRC): PgnMessage {
  const param = direction === 'next' ? 0 : 1
  return buildButtonPgn(CMD_PAGE_NAV, 'Direction', param, src)
}

// --- PGN 126720 builders (payload as pre-built Buffer) ---

// Sequence counter for trailing bytes (mimics real keypad behavior).
// Bytes 5-6 encode a counter C as: byte5 = 0x8e + (C & 7) * 0x10, byte6 = C >> 3.
// Bytes 1-2 are a timer snapshot; bytes 3-4 are a device constant.
let trailingSeq = 0

function buildTrailing(): Buffer {
  trailingSeq++
  const buf = Buffer.alloc(7)
  buf[0] = 0x2e
  const t = Date.now()
  buf[1] = 0x80 | (t & 0x7f)
  buf[2] = (t & 0x80) ? 0xb1 : 0xb0
  buf[3] = 0xf9
  buf[4] = 0xa9
  buf[5] = 0x8e + (trailingSeq & 7) * 0x10
  buf[6] = (trailingSeq >> 3) & 0xff
  return buf
}

function buildPropertyPayload(property: string, value: number): Buffer {
  const strLen = property.length + 1
  const strBuf = Buffer.from(property + '\0', 'ascii')
  const valueBuf = Buffer.from([value])

  // Skip first byte of PROPERTY_HEADER (command byte 0xe5) — canboatjs writes it from PGN Match
  return Buffer.concat([
    PROPERTY_HEADER.slice(1),
    Buffer.from([strLen]),
    strBuf,
    PROPERTY_SEPARATOR,
    valueBuf,
    buildTrailing()
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

export function buildIntensity(level: number, src: number = DEFAULT_SRC): PgnMessage {
  if (level < 0 || level > 2) {
    throw new Error(`Intensity level must be 0-2, got ${level}`)
  }
  return buildPropertyPgn(PROP_INTENSITY, level, src)
}

export function buildDisplaySelect(index: number, src: number = DEFAULT_SRC): PgnMessage {
  return buildPropertyPgn(PROP_DISPLAY, index, src)
}

export function buildHeartbeat(src: number = DEFAULT_SRC): PgnMessage {
  // Skip first byte of HEARTBEAT_HEADER (command byte 0xe7) — canboatjs writes it from PGN Match
  const payload = Buffer.concat([
    HEARTBEAT_HEADER.slice(1),
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
