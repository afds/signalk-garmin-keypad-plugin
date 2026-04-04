import createDebugFn from 'debug'
import {
  PLUGIN_ID,
  DEFAULT_SRC,
  INTENSITY_100,
  INTENSITY_50,
  INTENSITY_0
} from './protocol'
import {
  buildSelectPreset,
  buildSavePreset,
  buildPageNav,
  buildSleepWake,
  buildIntensity,
  buildDisplaySelect,
  buildHeartbeat,
  PgnMessage
} from './n2k'

const pgnDefinitions = require('./pgns')

const debug = createDebugFn(PLUGIN_ID)

interface PluginOptions {
  sourceAddress: number
}

interface PluginState {
  backlight: number
  sleeping: boolean
  n2kReady: boolean
}

export default function (app: any) {
  let options: PluginOptions = { sourceAddress: DEFAULT_SRC }
  let backlightLevel = INTENSITY_100
  let sleeping = false
  let n2kReady = false
  let n2kAvailableHandler: (() => void) | null = null

  function src(): number {
    return options.sourceAddress ?? DEFAULT_SRC
  }

  function emit(pgn: PgnMessage): void {
    if (!n2kReady) {
      debug('N2K output not yet available')
    }
    debug('Sending PGN %d: %j', pgn.pgn, pgn)
    app.emit('nmea2000JsonOut', pgn)
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
        }
      }
    },

    start: function (props: PluginOptions) {
      options = {
        sourceAddress: props.sourceAddress ?? DEFAULT_SRC
      }
      backlightLevel = INTENSITY_100
      sleeping = false
      n2kReady = false

      app.emitPropertyValue('canboat-custom-pgns', pgnDefinitions)
      debug('Registered custom PGN definitions')

      n2kAvailableHandler = () => {
        n2kReady = true
        debug('N2K output available')
      }
      app.on('nmea2000OutAvailable', n2kAvailableHandler)

      app.setPluginStatus('Started')
      debug('Plugin started, src=%d', src())
    },

    stop: function () {
      if (n2kAvailableHandler) {
        app.removeListener('nmea2000OutAvailable', n2kAvailableHandler)
        n2kAvailableHandler = null
      }
      n2kReady = false
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
          backlight: backlightLevel,
          sleeping,
          n2kReady
        }
        res.json(state)
      })

      router.post('/preset/select', (req: any, res: any) => {
        const index = req.body?.index
        if (typeof index !== 'number' || index < 0 || index > 3) {
          return res.status(400).json({ error: 'index must be 0-3' })
        }
        emit(buildSelectPreset(index, src()))
        res.json({ ok: true })
      })

      router.post('/preset/save', (req: any, res: any) => {
        const index = req.body?.index
        if (typeof index !== 'number' || index < 0 || index > 3) {
          return res.status(400).json({ error: 'index must be 0-3' })
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
        if (typeof index !== 'number' || index < 0) {
          return res.status(400).json({ error: 'index must be a non-negative number' })
        }
        emit(buildDisplaySelect(index, src()))
        res.json({ ok: true })
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

      router.post('/backlight', (req: any, res: any) => {
        const level = req.body?.level
        if (typeof level !== 'number' || level < 0 || level > 2) {
          return res.status(400).json({ error: 'level must be 0, 1, or 2' })
        }
        emit(buildIntensity(level, src()))
        backlightLevel = level
        res.json({ ok: true })
      })

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
    }
  }

  return plugin
}
