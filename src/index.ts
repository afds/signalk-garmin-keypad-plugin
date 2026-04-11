import {
  PLUGIN_ID,
  PGN_FAST,
  PGN_SINGLE,
  DEFAULT_SRC,
  DEFAULT_GROUP_ID_HEX,
  PROP_DISP_CNT,
  PROP_DISPLAY,
  PROP_SLEEP,
  parseGroupId
} from './protocol'
import {
  buildSelectPreset,
  buildSavePreset,
  buildPageNav,
  buildSleepWake,
  buildDisplaySelect,
  buildHeartbeat,
  buildDeviceIdent,
  buildDeviceHandshake,
  buildIsoRequest,
  setGroupId,
  setFingerprint,
  extractGroupIdFromPayload,
  encodePgnAsActisense,
  buildRawPropertyActisense,
  decodeCounter,
  ensureCounterAbove,
  resetCounters,
  PgnMessage
} from './n2k'

const pgnDefinitions = require('./pgns')

interface PluginOptions {
  sourceAddress: number
  groupId?: string
  displayCount?: number
  fingerprint?: string
  enableDebugRoutes?: boolean
}

interface PluginState {
  sleeping: boolean
  n2kReady: boolean
  displayCount: number
  activeDisplay: number
  handshakeComplete: boolean
}

export default function (app: any) {
  const debug = (...args: any[]) => app.debug(...args)

  let options: PluginOptions = { sourceAddress: DEFAULT_SRC }
  let sleeping = false
  let n2kReady = false
  let displayCount = 0
  let activeDisplay = 0
  let handshakeComplete = false
  let n2kAvailableHandler: (() => void) | null = null
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null
  let n2kDiscoveryListener: ((msg: any) => void) | null = null
  let propertyListener: ((msg: any) => void) | null = null
  let diagListener: ((msg: any) => void) | null = null
  let handshakeResponseListener: ((msg: any) => void) | null = null
  let rawSendListener: ((msg: any) => void) | null = null
  let rawInputListener: ((msg: any) => void) | null = null
  let handshakeTimers: ReturnType<typeof setTimeout>[] = []
  const displayAddresses = new Set<number>()
  const handshakeRespondedTo = new Set<number>()

  function src(): number {
    return options.sourceAddress ?? DEFAULT_SRC
  }

  function effectiveDisplayCount(): number {
    return displayCount > 0 ? displayCount : displayAddresses.size
  }

  function parsePayload(raw: any): Buffer | null {
    if (!raw) return null
    if (Buffer.isBuffer(raw)) return raw
    if (typeof raw === 'string' && raw.includes(' ')) {
      return Buffer.from(raw.split(' ').map(b => parseInt(b, 16)))
    }
    if (typeof raw === 'string') {
      return Buffer.from(raw, 'hex')
    }
    return null
  }

  function emit(pgn: PgnMessage): void {
    if (!n2kReady) {
      debug('N2K output not yet available')
    }
    debug('Sending PGN %d: %j', pgn.pgn, pgn)
    app.emit('nmea2000JsonOut', pgn)
  }

  // Send a PGN 126720 message as a raw actisense string, bypassing canboatjs toPgn.
  // This ensures prio is sent correctly and avoids any toPgn encoding issues.
  function emitRawActisense(actisense: string): void {
    if (!n2kReady) {
      debug('N2K output not yet available')
    }
    debug('Sending raw actisense: %s', actisense)
    app.emit('nmea2000out', actisense)
  }

  const plugin = {
    id: PLUGIN_ID,
    name: 'Garmin GNX Keypad',
    description:
      'Garmin GNX Keypad on NMEA 2000 to control GNX instrument displays',

    schema: {
      type: 'object' as const,
      title: 'Garmin GNX Keypad',
      properties: {
        sourceAddress: {
          type: 'number' as const,
          title: 'Source Address',
          description: 'NMEA 2000 source address for the keypad (note: the CAN gateway may override this)',
          default: 0
        },
        groupId: {
          type: 'string' as const,
          title: 'GNX Group ID (optional)',
          description:
            'Manual override for the 4-byte GNX group binding token (8 hex digits, e.g. "80d99efc"). '
            + 'Leave blank to auto-discover from the first heartbeat or property message on the bus. '
            + 'Find it in bytes 10-13 of any PGN 126720 0xe5/0xe7 message on your GNX bus.',
          default: ''
        },
        displayCount: {
          type: 'number' as const,
          title: 'Display Count (optional)',
          description:
            'Number of GNX displays in the group. Set to 0 to auto-discover from bus traffic. '
            + 'Set manually if auto-discovery fails (displays only broadcast count during startup).',
          default: 0
        },
        fingerprint: {
          type: 'string' as const,
          title: 'Keypad Fingerprint (optional)',
          description:
            'The 2-byte fingerprint the GNX displays have stored for the keypad (4 hex digits, e.g. "f9a9"). '
            + 'Displays reject property commands from a fingerprint that doesn\'t match their stored value. '
            + 'Default is f9a9 (real GNX Keypad). Find yours in the trailing bytes of any accepted '
            + 'gnx_selected_disp property command on your bus.',
          default: 'f9a9'
        },
        enableDebugRoutes: {
          type: 'boolean' as const,
          title: 'Enable Debug Routes',
          description:
            'Enable /debug/* HTTP endpoints for injecting raw NMEA 2000 traffic. '
            + 'Only enable during development.',
          default: false
        }
      }
    },

    start: function (props: PluginOptions) {
      options = {
        sourceAddress: props.sourceAddress ?? DEFAULT_SRC,
        enableDebugRoutes: !!props.enableDebugRoutes
      }
      sleeping = false
      n2kReady = false
      displayCount = 0
      activeDisplay = 0
      handshakeComplete = false
      handshakeTimers = []
      displayAddresses.clear()
      handshakeRespondedTo.clear()
      resetCounters()

      app.emitPropertyValue('canboat-custom-pgns', pgnDefinitions)
      debug('Registered custom PGN definitions')

      // Apply manual overrides from config
      if (props.displayCount && props.displayCount > 0) {
        displayCount = props.displayCount
        debug('Display count set from config: %d', displayCount)
      }

      // Apply fingerprint from config (or use default f9a9)
      const fpHex = props.fingerprint?.trim() || 'f9a9'
      if (fpHex.length === 4) {
        const b1 = parseInt(fpHex.slice(0, 2), 16)
        const b2 = parseInt(fpHex.slice(2, 4), 16)
        if (!isNaN(b1) && !isNaN(b2)) {
          setFingerprint([b1, b2])
          debug('Keypad fingerprint set: %s', fpHex)
        }
      }

      const manualId = props.groupId?.trim()
      let groupIdDiscovered = false
      if (manualId) {
        try {
          setGroupId(parseGroupId(manualId))
          groupIdDiscovered = true
          debug('Group ID set from config: %s', manualId)
        } catch (err) {
          debug('Invalid groupId in config, will auto-discover: %s', err)
        }
      }

      // Log all incoming Garmin N2K messages for diagnostics
      let dumpedRawOnce = false
      const diagHandler = (msg: any) => {
        const mfr = msg.fields?.['Manufacturer Code']
        if ((msg.pgn === PGN_FAST || msg.pgn === PGN_SINGLE) && (mfr === 229 || mfr === 'Garmin')) {
          const cmd = msg.fields?.['Command']
          debug('N2K IN pgn=%d src=%d dst=%d cmd=0x%s fields=%j',
            msg.pgn, msg.src, msg.dst,
            (cmd ?? 0).toString(16),
            msg.fields)
          if (!dumpedRawOnce && msg.pgn === PGN_FAST && cmd === 0xe5) {
            dumpedRawOnce = true
            const keys = Object.keys(msg).filter(k => k !== 'fields')
            debug('N2K raw msg keys: %j values: %j', keys, keys.reduce((o: any, k: string) => { o[k] = msg[k]; return o }, {}))
          }
        }
      }
      app.on('N2KAnalyzerOut', diagHandler)
      diagListener = diagHandler

      // Log the exact actisense string that canboatjs sends to the serial port.
      // This is emitted AFTER toPgn encoding, so we can compare actual vs expected bytes.
      const rawSendHandler = (msg: any) => {
        debug('canboatjs:rawsend %s', msg?.data ?? msg)
      }
      app.on('canboatjs:rawsend', rawSendHandler)
      rawSendListener = rawSendHandler

      // Listen for raw incoming actisense data BEFORE canboatjs parses (and truncates) it.
      // This lets us read the full trailing bytes (fingerprint + counter) from
      // NACKs that exceed the PGN definition's BitLength of 344 (43 bytes).
      const rawInputHandler = (msg: any) => {
        if (typeof msg !== 'string') return
        const parts = msg.split(',')
        if (parts.length < 9) return
        const pgn = parseInt(parts[2])
        if (pgn !== PGN_FAST) return
        const msgSrc = parseInt(parts[3])
        if (!displayAddresses.has(msgSrc)) return
        // Check for property command: bytes [6],[7] = e5,98 (garmin header), [8] = e5 (cmd)
        if (parts[6] !== 'e5' || parts[8] !== 'e5') return
        const len = parseInt(parts[5])
        if (len < 40) return
        // Parse data bytes into a buffer
        const dataBytes = parts.slice(6).map(h => parseInt(h, 16))
        const payload = Buffer.from(dataBytes.slice(3)) // skip e5,98,e5 header
        if (payload.length < 20) return
        const strLen = payload[13]
        if (payload.length < 14 + strLen) return
        const propName = payload.toString('ascii', 14, 14 + strLen - 1)
        const valueOffset = 14 + strLen + 3
        if (valueOffset >= payload.length) return
        const value = payload[valueOffset]
        // Full trailing bytes (7 bytes after value)
        const trailingStart = valueOffset + 1
        if (payload.length >= trailingStart + 7) {
          const t0 = payload[trailingStart]
          const t1 = payload[trailingStart + 1]
          const t2 = payload[trailingStart + 2]
          const t3 = payload[trailingStart + 3]
          const t4 = payload[trailingStart + 4]
          const t5 = payload[trailingStart + 5]
          const t6 = payload[trailingStart + 6]
          const storedSeq = decodeCounter(t5, t6)
          debug('RAW NACK %s src=%d val=%d fingerprint=%s counter=%d trailing=[%s]',
            propName, msgSrc, value,
            t3.toString(16).padStart(2, '0') + t4.toString(16).padStart(2, '0'),
            storedSeq,
            [t0, t1, t2, t3, t4, t5, t6].map(b => b.toString(16).padStart(2, '0')).join(' '))
          // Auto-adjust counter from the full (untruncated) NACK data
          ensureCounterAbove(propName, storedSeq)
        } else {
          debug('RAW NACK %s src=%d val=%d len=%d (still truncated)',
            propName, msgSrc, value, payload.length)
        }
      }
      app.on('canboatjs:rawoutput', rawInputHandler)
      rawInputListener = rawInputHandler

      // Auto-discover group ID and display addresses from incoming heartbeats.
      const discoveryHandler = (msg: any) => {
        if (msg.pgn !== PGN_FAST) return
        const fields = msg.fields
        const mfr = fields?.['Manufacturer Code']
        if (mfr !== 229 && mfr !== 'Garmin') return
        const cmd = fields?.['Command']
        if (cmd !== 0xe5 && cmd !== 0xe7) return
        const payload = parsePayload(fields?.['Payload'])

        // Discover group ID from first valid heartbeat/property message
        if (!groupIdDiscovered && payload) {
          const groupId = extractGroupIdFromPayload(payload)
          if (groupId) {
            groupIdDiscovered = true
            setGroupId(groupId)
            const hex = groupId.toString('hex')
            debug('Group ID auto-discovered: %s', hex)
            app.setPluginStatus(`Running — group ${hex}`)
          }
        }

        // Track display addresses from heartbeats (last payload byte: 0x01 = display, 0x00 = keypad)
        if (cmd === 0xe7 && payload && payload.length >= 14 && payload[13] === 0x01) {
          if (!displayAddresses.has(msg.src)) {
            displayAddresses.add(msg.src)
            debug('Display discovered at src=%d (total: %d)', msg.src, displayAddresses.size)
          }
        }
      }
      app.on('N2KAnalyzerOut', discoveryHandler)
      n2kDiscoveryListener = discoveryHandler

      // Listen for incoming property broadcasts to discover display count
      // and track active display selection.
      const propHandler = (msg: any) => {
        if (msg.pgn !== PGN_FAST) return
        const fields = msg.fields
        if (fields?.['Manufacturer Code'] !== 229 && fields?.['Manufacturer Code'] !== 'Garmin') return
        if (fields?.['Command'] !== 0xe5) return
        const payload = parsePayload(fields?.['Payload'])
        if (!payload || payload.length < 20) return

        const strLen = payload[13]
        if (payload.length < 14 + strLen) return
        const propName = payload.toString('ascii', 14, 14 + strLen - 1)

        const valueOffset = 14 + strLen + 3
        if (valueOffset >= payload.length) return
        const value = payload[valueOffset]

        // Extract stored counter from trailing bytes and auto-adjust our counter.
        // Trailing 7 bytes: [2e T1 T2 T3 T4 T5 T6] — T5/T6 encode the counter.
        if (payload.length >= valueOffset + 1 + 7) {
          const t5 = payload[payload.length - 2]
          const t6 = payload[payload.length - 1]
          const storedSeq = decodeCounter(t5, t6)
          debug('Counter discovery: %s src=%d stored=%d t5=0x%s t6=0x%s',
            propName, msg.src, storedSeq, t5.toString(16), t6.toString(16))
          ensureCounterAbove(propName, storedSeq)
        }

        if (propName === PROP_DISP_CNT && value > 0 && displayCount === 0) {
          displayCount = value
          debug('Display count discovered: %d', displayCount)
        }
        if (propName === PROP_DISPLAY) {
          activeDisplay = value
          debug('Active display updated: %d', activeDisplay)
        }
      }
      app.on('N2KAnalyzerOut', propHandler)
      propertyListener = propHandler

      // Respond to incoming 0x0a handshake requests from displays.
      // Displays send PGN 61184 cmd=0x0a to our address when they detect us
      // via ISO Address Claim. We must respond with 0xf5 identification +
      // 0x0a handshake back to that specific display to complete registration.
      const handshakeRespHandler = (msg: any) => {
        if (msg.pgn !== PGN_SINGLE) return
        const fields = msg.fields
        const mfr = fields?.['Manufacturer Code']
        if (mfr !== 229 && mfr !== 'Garmin') return
        const cmd = fields?.['Command']
        if (cmd !== 0x0a) return
        // Accept handshakes to any destination — the CAN gateway claims its
        // own address (e.g. 75) on the bus. No Garmin-specific firmware needed.
        // Don't filter by dst; just ensure it's from a known display.
        if (!displayAddresses.has(msg.src) && msg.dst === 255) return
        // Respond once per display address to avoid flooding
        if (handshakeRespondedTo.has(msg.src)) return
        handshakeRespondedTo.add(msg.src)

        debug('Incoming handshake (cmd 0x0a) from src=%d, responding with 0xf5 + 0x0a', msg.src)
        emit(buildDeviceIdent(src(), msg.src))
        setTimeout(() => {
          emit(buildDeviceHandshake(src(), msg.src))
        }, 200)
      }
      app.on('N2KAnalyzerOut', handshakeRespHandler)
      handshakeResponseListener = handshakeRespHandler

      n2kAvailableHandler = () => {
        n2kReady = true
        debug('N2K output available')

        // Start heartbeat immediately — displays need to see heartbeats
        // from us before they respond to handshakes
        if (!heartbeatInterval) {
          heartbeatInterval = setInterval(() => {
            emit(buildHeartbeat(src()))
          }, 1000)
          debug('Heartbeat started (1/sec)')
        }

        // ISO Request: ask each display for PGN 60928 (Address Claim).
        // Displays respond with their address claim and then 0xf5 identification.
        // No Garmin-specific Product Code needed — generic gateways work.
        const t0 = setTimeout(() => {
          if (displayAddresses.size > 0) {
            debug('Sending ISO Request (PGN 60928) to %d displays: %s',
              displayAddresses.size, [...displayAddresses].join(', '))
            for (const addr of displayAddresses) {
              emit(buildIsoRequest(60928, src(), addr))
            }
          } else {
            debug('No displays discovered, sending ISO Request (PGN 60928) broadcast')
            emit(buildIsoRequest(60928, src()))
          }
        }, 2000)
        handshakeTimers.push(t0)

        // Startup handshake after delay for group ID discovery
        // and display heartbeat exchange (~4s matches real keypad timing)
        const t1 = setTimeout(() => {
          if (displayAddresses.size > 0) {
            debug('Sending device identification (cmd 0xf5) to %d displays: %s',
              displayAddresses.size, [...displayAddresses].join(', '))
            for (const addr of displayAddresses) {
              emit(buildDeviceIdent(src(), addr))
            }
          } else {
            debug('No displays discovered, sending device identification (cmd 0xf5) broadcast')
            emit(buildDeviceIdent(src()))
          }

          const t2 = setTimeout(() => {
            if (displayAddresses.size > 0) {
              debug('Sending device handshake (cmd 0x0a) to %d displays: %s',
                displayAddresses.size, [...displayAddresses].join(', '))
              for (const addr of displayAddresses) {
                emit(buildDeviceHandshake(src(), addr))
              }
            } else {
              debug('Sending device handshake (cmd 0x0a) broadcast')
              emit(buildDeviceHandshake(src()))
            }

            // Send probes for ALL properties to discover stored counters
            // via NACK responses. Each probe will be rejected (counter too low),
            // triggering NACKs that reveal the display's stored counter.
            const t3 = setTimeout(() => {
              debug('Sending property probes to discover stored counters')
              emit(buildSleepWake(false, src()))
              emit(buildDisplaySelect(0, src()))
            }, 500)
            handshakeTimers.push(t3)

            // Wait for NACKs (~200ms) + cooldown (~2s) before sending wake
            // and allowing user commands. Displays may ignore commands from
            // a source that recently sent a rejected command.
            const t4 = setTimeout(() => {
              debug('Sending wake command')
              emit(buildSleepWake(false, src()))
              sleeping = false
              handshakeComplete = true
              debug('Handshake complete')
            }, 3500)
            handshakeTimers.push(t4)
          }, 500)
          handshakeTimers.push(t2)
        }, 4000)
        handshakeTimers.push(t1)
      }
      app.on('nmea2000OutAvailable', n2kAvailableHandler)

      app.setPluginStatus('Started')
      debug('Plugin started, src=%d', src())
    },

    stop: function () {
      handshakeTimers.forEach(t => clearTimeout(t))
      handshakeTimers = []
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval)
        heartbeatInterval = null
      }
      if (n2kAvailableHandler) {
        app.removeListener('nmea2000OutAvailable', n2kAvailableHandler)
        n2kAvailableHandler = null
      }
      if (n2kDiscoveryListener) {
        app.removeListener('N2KAnalyzerOut', n2kDiscoveryListener)
        n2kDiscoveryListener = null
      }
      if (propertyListener) {
        app.removeListener('N2KAnalyzerOut', propertyListener)
        propertyListener = null
      }
      if (diagListener) {
        app.removeListener('N2KAnalyzerOut', diagListener)
        diagListener = null
      }
      if (handshakeResponseListener) {
        app.removeListener('N2KAnalyzerOut', handshakeResponseListener)
        handshakeResponseListener = null
      }
      if (rawSendListener) {
        app.removeListener('canboatjs:rawsend', rawSendListener)
        rawSendListener = null
      }
      if (rawInputListener) {
        app.removeListener('canboatjs:rawoutput', rawInputListener)
        rawInputListener = null
      }
      displayAddresses.clear()
      handshakeRespondedTo.clear()
      n2kReady = false
      handshakeComplete = false
      debug('Plugin stopped')
    },

    registerWithRouter: function (router: any) {
      router.use((_req: any, _res: any, next: any) => {
        if (_req.method === 'POST') {
          // express.json() may not be available, parse manually if needed
          if (!_req.body && _req.headers['content-type']?.includes('application/json')) {
            let data = ''
            _req.on('data', (chunk: string) => { data += chunk })
            _req.on('end', () => {
              try {
                _req.body = JSON.parse(data)
              } catch {
                _req.body = {}
              }
              next()
            })
            return
          }
        }
        next()
      })

      router.get('/state', (_req: any, res: any) => {
        const state: PluginState = {
          sleeping,
          n2kReady,
          displayCount: effectiveDisplayCount(),
          activeDisplay,
          handshakeComplete
        }
        res.json(state)
      })

      router.post('/preset/select', (req: any, res: any) => {
        const index = req.body?.index
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 3) {
          return res.status(400).json({ error: 'index must be an integer 0-3' })
        }
        emit(buildSelectPreset(index, src()))
        res.json({ ok: true })
      })

      router.post('/preset/save', (req: any, res: any) => {
        const index = req.body?.index
        if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 3) {
          return res.status(400).json({ error: 'index must be an integer 0-3' })
        }
        emit(buildSavePreset(index, src()))
        res.json({ ok: true })
      })

      router.post('/page', (req: any, res: any) => {
        const direction = req.body?.direction
        if (direction !== 'next' && direction !== 'previous') {
          return res.status(400).json({ error: 'direction must be "next" or "previous"' })
        }
        emit(buildPageNav(direction, src()))
        res.json({ ok: true })
      })

      router.post('/display/select', (req: any, res: any) => {
        const index = req.body?.index
        if (typeof index !== 'number' || !Number.isInteger(index)) {
          return res.status(400).json({ error: 'index must be an integer' })
        }
        let target = index
        const count = effectiveDisplayCount()
        if (count > 0) {
          target = ((index % count) + count) % count
        } else if (index < 0) {
          target = 0
        }
        emit(buildDisplaySelect(target, src()))
        activeDisplay = target
        res.json({ ok: true, displayIndex: target })
      })

      router.post('/display/cycle', (req: any, res: any) => {
        const direction = req.body?.direction
        if (direction !== 'up' && direction !== 'down') {
          return res.status(400).json({ error: 'direction must be "up" or "down"' })
        }
        let next: number
        const count = effectiveDisplayCount()
        if (count > 0) {
          const delta = direction === 'down' ? 1 : -1
          next = ((activeDisplay + delta) % count + count) % count
        } else {
          next = direction === 'down'
            ? activeDisplay + 1
            : Math.max(0, activeDisplay - 1)
        }
        emit(buildDisplaySelect(next, src()))
        activeDisplay = next
        res.json({ ok: true, displayIndex: next })
      })

      router.post('/power', (req: any, res: any) => {
        const action = req.body?.action
        if (action !== 'sleep' && action !== 'wake') {
          return res.status(400).json({ error: 'action must be "sleep" or "wake"' })
        }
        const goToSleep = action === 'sleep'
        emit(buildSleepWake(goToSleep, src()))
        sleeping = goToSleep
        res.json({ ok: true })
      })

      if (options.enableDebugRoutes) {
        // Diagnostic: replay a raw actisense string to test NGT-1 fast-packet sending
        router.post('/debug/replay', (req: any, res: any) => {
          const actisense = req.body?.actisense
          if (typeof actisense !== 'string') {
            return res.status(400).json({ error: 'actisense string required' })
          }
          debug('Replaying raw actisense: %s', actisense)
          app.emit('nmea2000out', actisense)
          res.json({ ok: true })
        })

        // Diagnostic: send a property command as raw actisense (bypasses canboatjs toPgn).
        // Uses prio=7 (matching real keypad) and constructs bytes directly.
        // Test with: curl -X POST http://localhost:3000/plugins/signalk-garmin-keypad/debug/raw-property \
        //   -H 'Content-Type: application/json' -d '{"property":"gnx_selected_disp","value":1}'
        router.post('/debug/raw-property', (req: any, res: any) => {
          const property = req.body?.property
          const value = req.body?.value
          if (typeof property !== 'string' || typeof value !== 'number') {
            return res.status(400).json({ error: 'property (string) and value (number) required' })
          }
          const actisense = buildRawPropertyActisense(property, value, src())
          debug('Sending raw property actisense: %s', actisense)
          emitRawActisense(actisense)
          res.json({ ok: true, actisense })
        })

        // Diagnostic: send a PGN 126720 via raw actisense (bypasses toPgn, preserves prio)
        router.post('/debug/raw-pgn', (req: any, res: any) => {
          const property = req.body?.property
          const value = req.body?.value
          if (typeof property !== 'string' || typeof value !== 'number') {
            return res.status(400).json({ error: 'property (string) and value (number) required' })
          }
          // Build PGN object normally, then encode as raw actisense
          let builder: (v: number, s: number) => PgnMessage
          switch (property) {
            case 'gnx_selected_disp': builder = buildDisplaySelect; break
            case 'gnx_sleep_mode_id': builder = (v, s) => buildSleepWake(v === 0, s); break
            default:
              return res.status(400).json({ error: 'unknown property' })
          }
          const pgn = builder(value, src())
          const actisense = encodePgnAsActisense(pgn)
          debug('Sending raw PGN actisense: %s', actisense)
          emitRawActisense(actisense)
          res.json({ ok: true, actisense })
        })
      }
    }
  }

  return plugin
}
