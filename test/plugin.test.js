const { expect } = require('chai')
const EventEmitter = require('events')
const pluginFactory = require('../dist/').default

function createMockApp() {
  const app = new EventEmitter()
  app.emitted = []
  app.emittedRaw = []
  const origEmit = app.emit.bind(app)
  app.emit = function (event, ...args) {
    if (event === 'nmea2000JsonOut') {
      app.emitted.push(args[0])
    }
    if (event === 'nmea2000out') {
      app.emittedRaw.push(args[0])
    }
    return origEmit(event, ...args)
  }
  app.debug = () => {}
  app.error = () => {}
  app.setPluginStatus = () => {}
  app.setPluginError = () => {}
  app.emitPropertyValue = () => {}
  app.removeListener = app.off.bind(app)
  return app
}

function createMockRouter() {
  const routes = { get: {}, post: {} }
  const middleware = []
  const router = {
    get: (path, handler) => { routes.get[path] = handler },
    post: (path, handler) => { routes.post[path] = handler },
    use: (fn) => { middleware.push(fn) },
    _routes: routes,
    _middleware: middleware
  }
  return router
}

function createMockReq(method, body) {
  return {
    method,
    body,
    headers: { 'content-type': 'application/json' }
  }
}

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status: function (code) { res.statusCode = code; return res },
    json: function (data) { res.body = data; return res }
  }
  return res
}

describe('Plugin lifecycle', () => {
  it('creates plugin with correct id and name', () => {
    const app = createMockApp()
    const plugin = pluginFactory(app)
    expect(plugin.id).to.equal('signalk-garmin-keypad')
    expect(plugin.name).to.equal('Garmin GNX Keypad')
  })

  it('starts and stops without errors', () => {
    const app = createMockApp()
    const plugin = pluginFactory(app)
    plugin.start({ sourceAddress: 0 })
    plugin.stop()
  })

  it('registers custom PGN definitions on start', () => {
    const app = createMockApp()
    let registeredPgns = null
    app.emitPropertyValue = (key, value) => {
      if (key === 'canboat-custom-pgns') registeredPgns = value
    }
    const plugin = pluginFactory(app)
    plugin.start({ sourceAddress: 0 })
    expect(registeredPgns).to.not.be.null
    expect(registeredPgns.PGNs).to.be.an('array')
    expect(registeredPgns.PGNs.length).to.be.greaterThan(0)
    plugin.stop()
  })

  it('has a configuration schema', () => {
    const app = createMockApp()
    const plugin = pluginFactory(app)
    expect(plugin.schema).to.be.an('object')
    expect(plugin.schema.properties.sourceAddress).to.exist
  })
})

describe('REST API endpoints', () => {
  let app, plugin, router

  beforeEach(() => {
    app = createMockApp()
    plugin = pluginFactory(app)
    router = createMockRouter()
    plugin.registerWithRouter(router)
    plugin.start({ sourceAddress: 5 })
  })

  afterEach(() => {
    plugin.stop()
  })

  describe('GET /state', () => {
    it('returns current state', () => {
      const res = createMockRes()
      router._routes.get['/state']({}, res)
      expect(res.body.backlight).to.equal(0)
      expect(res.body.sleeping).to.equal(false)
    })
  })

  describe('POST /preset/select', () => {
    it('emits PGN 61184 with select preset fields', () => {
      const res = createMockRes()
      router._routes.post['/preset/select'](createMockReq('POST', { index: 0 }), res)
      expect(res.body).to.deep.equal({ ok: true })
      expect(app.emitted).to.have.length(1)

      const pgn = app.emitted[0]
      expect(pgn.pgn).to.equal(61184)
      expect(pgn.src).to.equal(5)
      expect(pgn['Command']).to.equal(0x84)
      expect(pgn['Preset Index']).to.equal(0)
    })

    it('returns 400 for invalid index', () => {
      const res = createMockRes()
      router._routes.post['/preset/select'](createMockReq('POST', { index: 5 }), res)
      expect(res.statusCode).to.equal(400)
    })

    it('returns 400 for missing index', () => {
      const res = createMockRes()
      router._routes.post['/preset/select'](createMockReq('POST', {}), res)
      expect(res.statusCode).to.equal(400)
    })
  })

  describe('POST /preset/save', () => {
    it('emits save preset command', () => {
      const res = createMockRes()
      router._routes.post['/preset/save'](createMockReq('POST', { index: 2 }), res)
      expect(res.body).to.deep.equal({ ok: true })

      const pgn = app.emitted[0]
      expect(pgn['Command']).to.equal(0x85)
      expect(pgn['Preset Index']).to.equal(2)
    })
  })

  describe('POST /page', () => {
    it('emits page next command', () => {
      const res = createMockRes()
      router._routes.post['/page'](createMockReq('POST', { direction: 'next' }), res)
      expect(res.body).to.deep.equal({ ok: true })

      const pgn = app.emitted[0]
      expect(pgn['Command']).to.equal(0x49)
      expect(pgn['Direction']).to.equal(0)
    })

    it('emits page previous command', () => {
      const res = createMockRes()
      router._routes.post['/page'](createMockReq('POST', { direction: 'previous' }), res)
      expect(app.emitted[0]['Direction']).to.equal(1)
    })

    it('returns 400 for invalid direction', () => {
      const res = createMockRes()
      router._routes.post['/page'](createMockReq('POST', { direction: 'left' }), res)
      expect(res.statusCode).to.equal(400)
    })
  })

  describe('POST /display/select', () => {
    it('emits PGN 126720 display select command', () => {
      const res = createMockRes()
      router._routes.post['/display/select'](createMockReq('POST', { index: 1 }), res)
      expect(res.body.ok).to.equal(true)
      expect(res.body.displayIndex).to.equal(1)
      expect(app.emitted).to.have.length(1)

      const pgn = app.emitted[0]
      expect(pgn.pgn).to.equal(126720)
      expect(pgn['Command']).to.equal(0xe5)
    })
  })

  describe('POST /power', () => {
    it('emits sleep command via PGN 126720', () => {
      const res = createMockRes()
      router._routes.post['/power'](createMockReq('POST', { action: 'sleep' }), res)
      expect(res.body).to.deep.equal({ ok: true })
      expect(app.emitted).to.have.length(1)

      const pgn = app.emitted[0]
      expect(pgn.pgn).to.equal(126720)
    })

    it('updates sleeping state', () => {
      const res = createMockRes()
      router._routes.post['/power'](createMockReq('POST', { action: 'sleep' }), res)

      const stateRes = createMockRes()
      router._routes.get['/state']({}, stateRes)
      expect(stateRes.body.sleeping).to.equal(true)
    })

    it('returns 400 for invalid action', () => {
      const res = createMockRes()
      router._routes.post['/power'](createMockReq('POST', { action: 'restart' }), res)
      expect(res.statusCode).to.equal(400)
    })
  })

  describe('POST /backlight', () => {
    it('emits backlight intensity command via PGN 126720', () => {
      const res = createMockRes()
      router._routes.post['/backlight'](createMockReq('POST', { level: 1 }), res)
      expect(res.body).to.deep.equal({ ok: true })
      expect(app.emitted).to.have.length(1)
      expect(app.emitted[0].pgn).to.equal(126720)
    })

    it('updates backlight state', () => {
      const res = createMockRes()
      router._routes.post['/backlight'](createMockReq('POST', { level: 2 }), res)

      const stateRes = createMockRes()
      router._routes.get['/state']({}, stateRes)
      expect(stateRes.body.backlight).to.equal(2)
    })

    it('returns 400 for invalid level', () => {
      const res = createMockRes()
      router._routes.post['/backlight'](createMockReq('POST', { level: 5 }), res)
      expect(res.statusCode).to.equal(400)
    })
  })

  describe('GET /state (extended fields)', () => {
    it('includes displayCount, activeDisplay, and handshakeComplete', () => {
      const stateRes = createMockRes()
      router._routes.get['/state']({}, stateRes)
      expect(stateRes.body).to.have.property('displayCount')
      expect(stateRes.body).to.have.property('activeDisplay')
      expect(stateRes.body).to.have.property('handshakeComplete')
      expect(stateRes.body.displayCount).to.be.a('number')
      expect(stateRes.body.activeDisplay).to.be.a('number')
      expect(stateRes.body.handshakeComplete).to.be.a('boolean')
    })
  })

  describe('POST /display/cycle', () => {
    it('cycles down (increments display index)', () => {
      // First select display 0
      const selectRes = createMockRes()
      router._routes.post['/display/select'](createMockReq('POST', { index: 0 }), selectRes)
      app.emitted = []

      const res = createMockRes()
      router._routes.post['/display/cycle'](createMockReq('POST', { direction: 'down' }), res)
      expect(res.body.ok).to.equal(true)
      expect(res.body.displayIndex).to.equal(1)
    })

    it('cycles up (decrements, clamped to 0 without displayCount)', () => {
      // Start at display 0
      const selectRes = createMockRes()
      router._routes.post['/display/select'](createMockReq('POST', { index: 0 }), selectRes)
      app.emitted = []

      const res = createMockRes()
      router._routes.post['/display/cycle'](createMockReq('POST', { direction: 'up' }), res)
      expect(res.body.ok).to.equal(true)
      expect(res.body.displayIndex).to.equal(0) // clamped at 0
    })

    it('returns 400 for invalid direction', () => {
      const res = createMockRes()
      router._routes.post['/display/cycle'](createMockReq('POST', { direction: 'left' }), res)
      expect(res.statusCode).to.equal(400)
    })
  })

  describe('POST /display/select (wrap-around)', () => {
    it('wraps negative index to 0 without displayCount', () => {
      const res = createMockRes()
      router._routes.post['/display/select'](createMockReq('POST', { index: -1 }), res)
      expect(res.body.displayIndex).to.equal(0)
    })
  })

  describe('integer validation', () => {
    it('/preset/select rejects non-integer index', () => {
      const res = createMockRes()
      router._routes.post['/preset/select'](createMockReq('POST', { index: 1.5 }), res)
      expect(res.statusCode).to.equal(400)
    })

    it('/preset/save rejects non-integer index', () => {
      const res = createMockRes()
      router._routes.post['/preset/save'](createMockReq('POST', { index: 0.5 }), res)
      expect(res.statusCode).to.equal(400)
    })

    it('/display/select rejects non-integer index', () => {
      const res = createMockRes()
      router._routes.post['/display/select'](createMockReq('POST', { index: 1.5 }), res)
      expect(res.statusCode).to.equal(400)
    })

    it('/display/select rejects NaN', () => {
      const res = createMockRes()
      router._routes.post['/display/select'](createMockReq('POST', { index: NaN }), res)
      expect(res.statusCode).to.equal(400)
    })

    it('/backlight rejects non-integer level', () => {
      const res = createMockRes()
      router._routes.post['/backlight'](createMockReq('POST', { level: 1.5 }), res)
      expect(res.statusCode).to.equal(400)
    })
  })
})

describe('Debug routes', () => {
  it('are not registered by default', () => {
    const app = createMockApp()
    const plugin = pluginFactory(app)
    const router = createMockRouter()
    plugin.start({ sourceAddress: 0 })
    plugin.registerWithRouter(router)
    expect(router._routes.post['/debug/replay']).to.be.undefined
    expect(router._routes.post['/debug/raw-property']).to.be.undefined
    expect(router._routes.post['/debug/raw-pgn']).to.be.undefined
    plugin.stop()
  })

  it('are registered when enableDebugRoutes is true', () => {
    const app = createMockApp()
    const plugin = pluginFactory(app)
    const router = createMockRouter()
    plugin.start({ sourceAddress: 0, enableDebugRoutes: true })
    plugin.registerWithRouter(router)
    expect(router._routes.post['/debug/replay']).to.be.a('function')
    expect(router._routes.post['/debug/raw-property']).to.be.a('function')
    expect(router._routes.post['/debug/raw-pgn']).to.be.a('function')
    plugin.stop()
  })
})
