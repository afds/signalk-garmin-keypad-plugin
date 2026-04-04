const { expect } = require('chai')
const {
  buildSelectPreset,
  buildSavePreset,
  buildPageNav,
  buildSleepWake,
  buildIntensity,
  buildDisplaySelect,
  buildHeartbeat
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
})
