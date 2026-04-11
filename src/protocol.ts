export const PLUGIN_ID = 'signalk-garmin-keypad'

// PGN numbers
export const PGN_SINGLE = 61184
export const PGN_FAST = 126720

// PGN 61184 command bytes
export const CMD_SELECT_PRESET = 0x84
export const CMD_SAVE_PRESET = 0x85
export const CMD_PAGE_NAV = 0x49

// Device identification bytes (constant in all PGN 61184 messages)
export const PRODUCT_ID = 0x17
export const UNK1 = 0x02
export const UNK2 = 0x02

// PGN 126720 property names
export const PROP_SLEEP = 'gnx_sleep_mode_id'
export const PROP_DISPLAY = 'gnx_selected_disp'
export const PROP_DISP_CNT = 'gnx_disp_cnt'

// Sleep/wake values
export const SLEEP = 0
export const WAKE = 1

// N2K defaults
export const DEFAULT_SRC = 0
export const DEFAULT_DST = 255
export const DEFAULT_PRIO = 7

// Default GNX group ID — the 4-byte binding token shared by all devices in a group.
// Configured during Garmin group setup; persists in device NVM. Any keypad emulation
// must use the group ID that matches the target display group.
// Bytes 10-13 of any PGN 126720 0xe5 or 0xe7 message on the GNX bus.
const DEFAULT_GROUP_ID_HEX = '80d99efc'
export const DEFAULT_GROUP_ID = Buffer.from(DEFAULT_GROUP_ID_HEX, 'hex')

// Property command header layout (14 bytes total):
//   [0]     0xe5            — command byte (consumed by canboatjs PGN Match, NOT in Payload)
//   [1-3]   08 0a 0a        — protocol version
//   [4-7]   05 01 03 0d     — shared device field
//   [8-11]  [groupId]       — GROUP ID: 4-byte binding token for this GNX group
//   [12-13] 08 1f           — message subtype (property commands)
export function buildPropertyHeader(groupId: Buffer): Buffer {
  return Buffer.from([
    0xe5, 0x08, 0x0a, 0x0a, 0x05, 0x01,
    0x03, 0x0d, groupId[0], groupId[1], groupId[2], groupId[3],
    0x08, 0x1f
  ])
}

export function parseGroupId(hexStr: string): Buffer {
  const cleaned = hexStr.replace(/[^0-9a-fA-F]/g, '')
  if (cleaned.length !== 8) {
    throw new Error(`groupId must be exactly 4 bytes (8 hex digits), got: "${hexStr}"`)
  }
  return Buffer.from(cleaned, 'hex')
}

export const PROPERTY_SEPARATOR = Buffer.from([0x23, 0x09, 0x01])
