# signalk-garmin-keypad

Signal K server plugin that acts as a Garmin GNX Keypad on NMEA 2000, allowing control of GNX instrument displays from a web browser.

## Features

- **Preset selection** (1-4) — short press to recall, long press to save
- **Page navigation** — up/down on the active display
- **Display selection** — switch between configured GNX displays
- **Power control** — sleep/wake
- **Embeddable webapp** — dark-themed UI matching the physical keypad, embedded in the Signal K admin UI via Module Federation

## Protocol

Sends Garmin proprietary NMEA 2000 messages:

- **PGN 61184** — single-frame button events (preset select/save, page navigation)
- **PGN 126720** — fast-packet property commands (display selection, sleep/wake, heartbeat)

Based on reverse-engineered protocol documented in `canboatjs/GARMIN_GNX_KEYPAD.md`.

## Configuration

| Option | Description | Default |
|---|---|---|
| Source Address | NMEA 2000 source address for the keypad | 0 |
| Displays | Array of `{ name, index }` for each GNX display to control | [] |

## REST API

All endpoints at `/plugins/signalk-garmin-keypad/`:

| Method | Path | Body |
|---|---|---|
| GET | `/state` | — |
| POST | `/preset/select` | `{ "index": 0-3 }` |
| POST | `/preset/save` | `{ "index": 0-3 }` |
| POST | `/page` | `{ "direction": "next" \| "previous" }` |
| POST | `/display/select` | `{ "index": number }` |
| POST | `/power` | `{ "action": "sleep" \| "wake" }` |

## Development

```sh
npm install
npm run build:plugin   # compile TypeScript
cd webapp && npm install && npm run build  # build React webapp
npm test               # run tests
```

## License

Apache-2.0
