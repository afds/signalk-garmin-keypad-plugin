const { expect } = require('chai')
const {
  buildSelectPreset,
  buildSavePreset,
  buildPageNav,
  buildSleepWake,
  buildIntensity,
  buildDisplaySelect,
  buildHeartbeat,
  buildDeviceIdent,
  buildDeviceHandshake,
  resetCounters
} = require('../dist/n2k')

describe('PGN 61184 button event builders', () => {
  describe('buildSelectPreset', () => {
    it('returns PGN object with correct fields', () => {
      const pgn = buildSelectPreset(0)
      expect(pgn.pgn).to.equal(61184)
      expect(pgn.dst).to.equal(255)
      expect(pgn.prio).to.equal(7)
      expect(pgn['Manufacturer Code']).to.equal(229)
      expect(pgn['Industry Code']).to.equal(4)
      expect(pgn['Command']).to.equal(0x84)
      expect(pgn['Product ID']).to.equal(0x17)
      expect(pgn['Unknown 1']).to.equal(0x02)
      expect(pgn['Unknown 2']).to.equal(0x02)
      expect(pgn['Preset Index']).to.equal(0)
    })

    it('sets correct preset index', () => {
      expect(buildSelectPreset(3)['Preset Index']).to.equal(3)
    })

    it('uses provided source address', () => {
      expect(buildSelectPreset(0, 42).src).to.equal(42)
    })

    it('throws for invalid preset index', () => {
      expect(() => buildSelectPreset(4)).to.throw()
      expect(() => buildSelectPreset(-1)).to.throw()
    })

    it('throws for non-integer preset index', () => {
      expect(() => buildSelectPreset(1.5)).to.throw()
      expect(() => buildSelectPreset(NaN)).to.throw()
    })
  })

  describe('buildSavePreset', () => {
    it('returns PGN object with command 0x85', () => {
      const pgn = buildSavePreset(0)
      expect(pgn.pgn).to.equal(61184)
      expect(pgn['Command']).to.equal(0x85)
      expect(pgn['Preset Index']).to.equal(0)
    })

    it('sets correct preset index', () => {
      expect(buildSavePreset(2)['Preset Index']).to.equal(2)
    })

    it('throws for invalid preset index', () => {
      expect(() => buildSavePreset(4)).to.throw()
    })
  })

  describe('buildPageNav', () => {
    it('returns PGN object for next (direction=0)', () => {
      const pgn = buildPageNav('next')
      expect(pgn.pgn).to.equal(61184)
      expect(pgn['Command']).to.equal(0x49)
      expect(pgn['Direction']).to.equal(0)
    })

    it('returns PGN object for previous (direction=1)', () => {
      const pgn = buildPageNav('previous')
      expect(pgn['Direction']).to.equal(1)
    })
  })
})

describe('PGN 126720 property command builders', () => {
  describe('buildSleepWake', () => {
    it('returns PGN 126720 with property command marker', () => {
      const pgn = buildSleepWake(true)
      expect(pgn.pgn).to.equal(126720)
      expect(pgn['Command']).to.equal(0xe5)
      expect(pgn['Manufacturer Code']).to.equal(229)
    })

    it('payload contains gnx_sleep_mode_id property name', () => {
      const pgn = buildSleepWake(true)
      const payload = pgn['Payload']
      expect(payload).to.be.instanceOf(Buffer)
      // PROPERTY_HEADER minus command byte = 13 bytes, then strLen byte, then property name
      const prop = 'gnx_sleep_mode_id'
      const str = payload.toString('ascii', 14, 14 + prop.length)
      expect(str).to.equal(prop)
    })

    it('sleep has value 0', () => {
      const pgn = buildSleepWake(true)
      const payload = pgn['Payload']
      const prop = 'gnx_sleep_mode_id'
      // header(13) + strLen(1) + string(17) + null(1) + separator(3) + value
      const valueOffset = 13 + 1 + prop.length + 1 + 3
      expect(payload[valueOffset]).to.equal(0x00)
    })

    it('wake has value 1', () => {
      const pgn = buildSleepWake(false)
      const payload = pgn['Payload']
      const prop = 'gnx_sleep_mode_id'
      const valueOffset = 13 + 1 + prop.length + 1 + 3
      expect(payload[valueOffset]).to.equal(0x01)
    })
  })

  describe('buildIntensity', () => {
    it('payload contains gnx_intensity_state_id property name', () => {
      const pgn = buildIntensity(0)
      const payload = pgn['Payload']
      const prop = 'gnx_intensity_state_id'
      const str = payload.toString('ascii', 14, 14 + prop.length)
      expect(str).to.equal(prop)
    })

    it('sets correct intensity values', () => {
      const prop = 'gnx_intensity_state_id'
      const valueOffset = 13 + 1 + prop.length + 1 + 3

      expect(buildIntensity(0)['Payload'][valueOffset]).to.equal(0x00)
      expect(buildIntensity(1)['Payload'][valueOffset]).to.equal(0x01)
      expect(buildIntensity(2)['Payload'][valueOffset]).to.equal(0x02)
    })

    it('throws for invalid level', () => {
      expect(() => buildIntensity(3)).to.throw()
      expect(() => buildIntensity(-1)).to.throw()
    })

    it('throws for non-integer level', () => {
      expect(() => buildIntensity(1.5)).to.throw()
      expect(() => buildIntensity(NaN)).to.throw()
    })
  })

  describe('buildDisplaySelect', () => {
    it('payload contains gnx_selected_disp property name', () => {
      const pgn = buildDisplaySelect(2)
      const payload = pgn['Payload']
      const prop = 'gnx_selected_disp'
      const str = payload.toString('ascii', 14, 14 + prop.length)
      expect(str).to.equal(prop)
    })

    it('sets correct display index value', () => {
      const pgn = buildDisplaySelect(2)
      const payload = pgn['Payload']
      const prop = 'gnx_selected_disp'
      const valueOffset = 13 + 1 + prop.length + 1 + 3
      expect(payload[valueOffset]).to.equal(0x02)
    })

    it('throws for non-integer index', () => {
      expect(() => buildDisplaySelect(1.5)).to.throw()
    })

    it('throws for negative index', () => {
      expect(() => buildDisplaySelect(-1)).to.throw()
    })

    it('throws for NaN', () => {
      expect(() => buildDisplaySelect(NaN)).to.throw()
    })

    it('throws for Infinity', () => {
      expect(() => buildDisplaySelect(Infinity)).to.throw()
    })
  })

  describe('buildHeartbeat', () => {
    it('returns PGN 126720 with heartbeat command 0xe7', () => {
      const pgn = buildHeartbeat()
      expect(pgn.pgn).to.equal(126720)
      expect(pgn['Command']).to.equal(0xe7)
    })

    it('payload contains heartbeat header and direction byte', () => {
      const pgn = buildHeartbeat()
      const payload = pgn['Payload']
      expect(payload).to.be.instanceOf(Buffer)
      // HEARTBEAT_HEADER.slice(1) (13 bytes) + direction (1 byte) = 14 bytes
      expect(payload.length).to.equal(14)
      // First byte of payload (second byte of HEARTBEAT_HEADER, after command byte)
      expect(payload[0]).to.equal(0x08)
      // Last byte is direction=request
      expect(payload[13]).to.equal(0x00)
    })
  })

  describe('buildDeviceIdent', () => {
    it('returns PGN 126720 with command 0xf5', () => {
      const pgn = buildDeviceIdent()
      expect(pgn.pgn).to.equal(126720)
      expect(pgn['Command']).to.equal(0xf5)
      expect(pgn['Manufacturer Code']).to.equal(229)
    })

    it('payload is 47 bytes (50 total minus 3 canboatjs header bytes)', () => {
      const pgn = buildDeviceIdent()
      const payload = pgn['Payload']
      expect(payload).to.be.instanceOf(Buffer)
      expect(payload.length).to.equal(47)
    })

    it('payload contains "GNX Keypad" product name at offset 3', () => {
      const pgn = buildDeviceIdent()
      const payload = pgn['Payload']
      const name = payload.toString('ascii', 3, 3 + 10)
      expect(name).to.equal('GNX Keypad')
    })

    it('uses provided source address', () => {
      expect(buildDeviceIdent(42).src).to.equal(42)
    })
  })

  describe('buildDeviceHandshake', () => {
    it('returns PGN 61184 with command 0x0a', () => {
      const pgn = buildDeviceHandshake()
      expect(pgn.pgn).to.equal(61184)
      expect(pgn['Command']).to.equal(0x0a)
      expect(pgn['Manufacturer Code']).to.equal(229)
    })

    it('has correct fixed handshake payload', () => {
      const pgn = buildDeviceHandshake()
      expect(pgn['Unknown 1']).to.equal(0x00)
      expect(pgn['Unknown 2']).to.equal(0x02)
      expect(pgn['Unknown 3']).to.equal(0x02)
      expect(pgn['Unknown 4']).to.equal(0xa4)
      expect(pgn['Unknown 5']).to.equal(0x00)
    })

    it('uses provided source address', () => {
      expect(buildDeviceHandshake(7).src).to.equal(7)
    })
  })

  describe('per-property counters', () => {
    beforeEach(() => {
      resetCounters()
    })

    it('different properties get independent counters', () => {
      const sleep1 = buildSleepWake(true)
      const disp1 = buildDisplaySelect(0)
      const sleep2 = buildSleepWake(false)

      // Trailing bytes are last 7 bytes of each payload
      const sleepPayload1 = sleep1['Payload']
      const dispPayload = disp1['Payload']
      const sleepPayload2 = sleep2['Payload']

      // Counters start at 0 after reset (prev=-1, seq=(prev+1)&0x3FF=0)
      // Sleep seq=0 → T5=0x8e + (0 & 7)*0x10 = 0x8e, seq=1 → 0x9e
      const sleepT5_1 = sleepPayload1[sleepPayload1.length - 2]
      const sleepT5_2 = sleepPayload2[sleepPayload2.length - 2]
      expect(sleepT5_1).to.equal(0x8e) // seq=0
      expect(sleepT5_2).to.equal(0x9e) // seq=1

      // Display counter: seq=0 → T5=0x8e (independent from sleep)
      const dispT5 = dispPayload[dispPayload.length - 2]
      expect(dispT5).to.equal(0x8e) // seq=0
    })
  })
})
