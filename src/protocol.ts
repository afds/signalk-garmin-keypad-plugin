export const PLUGIN_ID = 'signalk-garmin-keypad'

// PGN numbers
export const PGN_SINGLE = 61184
export const PGN_FAST = 126720

// Garmin manufacturer header bytes (manufacturer code 229, industry code 4 = Marine)
export const GARMIN_HEADER = [0xe5, 0x98] as const

// PGN 61184 command bytes
export const CMD_SELECT_PRESET = 0x84
export const CMD_SAVE_PRESET = 0x85
export const CMD_PAGE_NAV = 0x49
export const CMD_DEVICE_ACK = 0x48

// PGN 126720 command bytes
export const CMD_PROPERTY = 0xe5
export const CMD_HEARTBEAT = 0xe7

// Device identification bytes (constant in all PGN 61184 messages)
export const PRODUCT_ID = 0x17
export const UNK1 = 0x02
export const UNK2 = 0x02

// PGN 126720 property names
export const PROP_SLEEP = 'gnx_sleep_mode_id'
export const PROP_INTENSITY = 'gnx_intensity_state_id'
export const PROP_DISPLAY = 'gnx_selected_disp'

// Sleep/wake values
export const SLEEP = 0
export const WAKE = 1

// Backlight intensity values
export const INTENSITY_100 = 0
export const INTENSITY_50 = 1
export const INTENSITY_0 = 2

// N2K defaults
export const DEFAULT_SRC = 0
export const DEFAULT_DST = 255
export const DEFAULT_PRIO = 7

// PGN 126720 property command header (bytes 2-15, constant for all property commands)
export const PROPERTY_HEADER = Buffer.from([
  0xe5, 0x08, 0x0a, 0x0a, 0x05, 0x01,
  0x03, 0x0d, 0x80, 0xd9, 0x9e, 0xfc,
  0x08, 0x1f
])

// PGN 126720 heartbeat header (bytes 2-15, slightly different from property header)
export const HEARTBEAT_HEADER = Buffer.from([
  0xe7, 0x08, 0x0a, 0x0a, 0x03, 0x01,
  0x03, 0x0d, 0x80, 0xd9, 0x9e, 0xfc,
  0x08, 0x11
])

// Property value separator bytes
export const PROPERTY_SEPARATOR = Buffer.from([0x23, 0x09, 0x01])
