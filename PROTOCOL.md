# Garmin GNX Keypad — NMEA 2000 Protocol

This document describes the Garmin-proprietary NMEA 2000 messages used by this plugin
to emulate a GNX keypad and control GNX instrument displays.

## Overview

Two PGNs are used, both Garmin-proprietary (Manufacturer Code 229, Industry Code 4 / Marine):

| PGN | Type | Purpose |
|-----|------|---------|
| 61184 | Single frame (7 bytes) | Button events — preset select/save, page navigation |
| 126720 | Fast packet (multi-frame) | Property commands (display selection, sleep/wake) and heartbeat |

Default transport parameters: source 0, destination 255 (broadcast), priority 7.

---

## PGN 61184 — Button Events

Single-frame CAN messages (7 data bytes). Three command variants share a common header.

### Wire layout

| Byte | Bits | Field | Value |
|------|------|-------|-------|
| 0–1 | 0–10 | Manufacturer Code | 229 (Garmin) |
| 0–1 | 11–12 | Reserved | — |
| 0–1 | 13–15 | Industry Code | 4 (Marine) |
| 2 | — | Command | varies (see below) |
| 3 | — | Product ID | 0x17 |
| 4 | — | Unknown 1 | 0x02 |
| 5 | — | Unknown 2 | 0x02 |
| 6 | — | Parameter | varies (see below) |

Bytes 0–1 on the wire are `e5 98` (Manufacturer Code 229 packed little-endian with
Industry Code 4).

### Commands

#### 0x84 — Select Preset (short press)

Recalls a saved preset on the active display.

- **Byte 6**: Preset Index (0–3)
- Example: `e5 98 84 17 02 02 00` — select preset 1

#### 0x85 — Save Preset (long press)

Saves the current display state to a preset slot.

- **Byte 6**: Preset Index (0–3)
- Example: `e5 98 85 17 02 02 02` — save preset 3

#### 0x49 — Page Navigation

Navigates between pages on the active display.

- **Byte 6**: Direction — 0 = next (down), 1 = previous (up)
- Example: `e5 98 49 17 02 02 00` — page down

---

## PGN 126720 — Property Commands & Heartbeat

Fast-packet messages using NMEA 2000 multi-frame transport. All variants share the
standard proprietary header in bytes 0–1 (Manufacturer Code 229, Industry Code 4),
followed by a command byte at offset 2.

### 0xe5 — Property Command

Variable-length message used to set device properties. Displays validate the
fingerprint and per-property sequence counter before accepting the command.

#### Wire layout (after fast-packet reassembly)

```
 Offset  Bytes  Field
 ──────  ─────  ──────────────────────────────────────────
  0–1      2    NMEA 2000 proprietary header (mfr 229, industry 4)
  2        1    Command: 0xe5
  3–5      3    Protocol version: 08 0a 0a
  6–9      4    Device field: 05 01 03 0d
 10–13     4    Group ID (4-byte binding token)
 14–15     2    Message subtype: 08 1f
 16        1    String length (property name + null terminator)
 17–N      var  Property name (null-terminated ASCII)
  +0       3    Property separator: 23 09 01
  +3       1    Value (unsigned byte)
  +4       7    Trailing signature (see below)
```

Total on-wire size depends on property name length:
`3 (mfr+cmd) + 13 (header) + 1 (strlen) + (name_len + 1) + 3 (separator) + 1 (value) + 7 (trailing)`

For 17-char names (`gnx_sleep_mode_id`, `gnx_selected_disp`): 46 bytes.

#### Known properties

| Property name | Values | Purpose |
|---------------|--------|---------|
| `gnx_sleep_mode_id` | 0 = sleep, 1 = wake | Display power control |
| `gnx_selected_disp` | 0-based display index | Active display selection |
| `gnx_disp_cnt` | integer (e.g. 3 for 3 displays) | Display count (broadcast by displays, not set by keypad) |

The real keypad also sends `gnx_intensity_state_id` (backlight intensity cycling) —
this plugin does not implement it.

#### Trailing signature (7 bytes)

All keypad property commands end with 7 bytes starting with marker `0x2e`:

| Offset | Field | Encoding |
|--------|-------|----------|
| T0 | Marker | Always 0x2e |
| T1 | Random nonce | 0x80 \| (random 0–127). **Bit 7 must be set** — displays reject values < 0x80. |
| T2 | State flag | 0xb0 or 0xb1 — only bit 0 changes. Alternates between presses. |
| T3 | Fingerprint byte 1 | Keypad fingerprint high byte |
| T4 | Fingerprint byte 2 | Keypad fingerprint low byte |
| T5 | Counter low | 0x8e + (C & 7) * 0x10 |
| T6 | Counter high | C >> 3 |

**Sequence counter** — encoded as a 10-bit value maintained independently per property
name. Displays reject commands unless the counter is strictly greater than the last
accepted value. Counters persist in display NVM across reboots.

Encoding: `T5 = 0x8e + (C & 7) * 0x10`, `T6 = C >> 3`
Decoding: `C = (T6 << 3) | ((T5 - 0x8e) >> 4)`

T5's low nibble is always `0xe` (from the `0x8e` base); the high nibble cycles
`8 → 9 → a → b → c → d → e → f → (carry) → 8 …`. When it wraps, T6 increments by 1.

**Fingerprint** — 2-byte identifier. Displays persist the fingerprint of the last
keypad that successfully modified each property and reject commands from a different
fingerprint. Discovered from bus traffic (see [Auto-Discovery](#auto-discovery)).

### 0xe7 — Heartbeat

Fixed-length (17 bytes total) periodic heartbeat exchanged between keypads and displays.

#### Wire layout (after fast-packet reassembly)

```
 Offset  Bytes  Field
 ──────  ─────  ──────────────────────────────────────────
  0–1      2    NMEA 2000 proprietary header (mfr 229, industry 4)
  2        1    Command: 0xe7
  3–5      3    Protocol version: 08 0a 0a
  6–9      4    Device field: 03 01 03 0d
 10–13     4    Group ID (4-byte binding token)
 14–15     2    Message subtype: 08 11
 16        1    Direction: 0x00 = request (from keypad), 0x01 = response (from display)
```

The Group ID is at wire offsets 10–13, the same position as in property commands.

Note the header differs from property commands: device field byte 6 is `0x03` (vs `0x05`
in 0xe5), and subtype is `08 11` (vs `08 1f` in 0xe5).

---

## Group ID

A 4-byte binding token shared by all devices in a GNX display group. Configured during
Garmin group setup and persisted in device NVM. Found at wire bytes 10–13 of any
PGN 126720 message (both 0xe5 and 0xe7 variants).

All keypad commands must use the group ID that matches the target display group.

---

## Display Acceptance / Rejection (NACK/ACK)

When a display **rejects** a property command (wrong T1, counter too low, or fingerprint
mismatch), it broadcasts its **current stored state** as a PGN 126720 cmd 0xe5 message
(dst=255). The broadcast contains the stored value, counter, and fingerprint from the
last accepted command. All displays in the group echo the same stored state.

When a display **accepts** a property command, it responds with PGN 61184 cmd 0x48
(acknowledgement, broadcast to dst=255). No 0xe5 broadcast occurs on acceptance.

### Display cooldown after rejection

After rejecting a command, displays may enter a brief cooldown period during which they
silently ignore subsequent commands from the same source address. This means progressive
counter bumping (send N, get NACK, try N+1, …) does **not** work reliably.

The plugin works around this with a single-retry approach: send speculatively, sync
counter/fingerprint from the NACK, then retry once after 250 ms. This avoids the
cooldown because only one retry is attempted after a short delay.

---

## Auto-Discovery

The plugin discovers protocol parameters from bus traffic rather than requiring manual
configuration. All discovery is optional — values can be set manually in plugin config.

| Parameter | Source | Mechanism |
|-----------|--------|-----------|
| Group ID | Any PGN 126720 (0xe5 or 0xe7) | Extract bytes 10–13 from first observed message |
| Display count | `gnx_disp_cnt` property value in 0xe5 responses | Read value byte from property response payload |
| Keypad fingerprint | Trailing bytes T3–T4 of 0xe5 responses | First property command is sent with zeroed fingerprint; display NACKs with stored fingerprint; retry with corrected value |
| Per-property counter | Trailing bytes T5–T6 of 0xe5 responses | Display rejects stale counters; counter from rejection is decoded and used for retry |
| Display addresses | 0xe7 heartbeat with direction 0x01 | Source address of heartbeat sender is recorded |

The plugin uses a lazy retry pattern: the first property command for each property is
sent speculatively (with potentially stale counter/fingerprint). If the display NACKs,
the rejection carries the correct values. The plugin syncs from the NACK and retries
250 ms later.

---

## Message Direction

| Message | Direction | Notes |
|---------|-----------|-------|
| PGN 61184 — Select Preset (0x84) | Plugin → Bus | Broadcast |
| PGN 61184 — Save Preset (0x85) | Plugin → Bus | Broadcast |
| PGN 61184 — Page Nav (0x49) | Plugin → Bus | Broadcast |
| PGN 126720 — Property Command (0xe5) | Plugin → Bus | With retry on NACK |
| PGN 126720 — Property Response (0xe5) | Bus → Plugin | Display NACK broadcast; used for counter/fingerprint sync |
| PGN 126720 — Heartbeat (0xe7) | Bus → Plugin | Display presence; used for group ID and display discovery |
