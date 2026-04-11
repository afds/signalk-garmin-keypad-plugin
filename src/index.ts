import { PLUGIN_ID, PGN_FAST, DEFAULT_SRC, PROP_DISP_CNT, PROP_DISPLAY, PROP_SLEEP, parseGroupId } from "./protocol";
import {
  buildSelectPreset,
  buildSavePreset,
  buildPageNav,
  buildSleepWake,
  buildDisplaySelect,
  setGroupId,
  setFingerprint,
  extractGroupIdFromPayload,
  decodeCounter,
  ensureCounterAbove,
  resetCounters,
  PgnMessage,
} from "./n2k";

const pgnDefinitions = require('./pgns')

interface PluginOptions {
  sourceAddress: number
  groupId?: string
  displayCount?: number
  fingerprint?: string
}

interface PluginState {
  sleeping: boolean;
  displayCount: number;
  activeDisplay: number;
}

export default function (app: any) {
  const debug = (...args: any[]) => app.debug(...args)

  let options: PluginOptions = { sourceAddress: DEFAULT_SRC }
  let sleeping = false;
  let displayCount = 0
  let activeDisplay = 0
  let n2kDiscoveryListener: ((msg: any) => void) | null = null
  let propertyListener: ((msg: any) => void) | null = null
  let rawInputListener: ((msg: any) => void) | null = null;
  let retryTimers: ReturnType<typeof setTimeout>[] = [];
  const displayAddresses = new Set<number>();
  const syncedProperties = new Set<string>();

  function src(): number {
    return options.sourceAddress ?? DEFAULT_SRC;
  }

  function effectiveDisplayCount(): number {
    return displayCount > 0 ? displayCount : displayAddresses.size;
  }

  function parsePayload(raw: any): Buffer | null {
    if (!raw) return null;
    if (Buffer.isBuffer(raw)) return raw;
    if (typeof raw === "string" && raw.includes(" ")) {
      return Buffer.from(raw.split(" ").map((b) => parseInt(b, 16)));
    }
    if (typeof raw === "string") {
      return Buffer.from(raw, "hex");
    }
    return null;
  }

  function emit(pgn: PgnMessage): void {
    debug("Sending PGN %d: %j", pgn.pgn, pgn);
    app.emit("nmea2000JsonOut", pgn);
  }

  // Send a property command with lazy discovery retry.
  // On first use of each property, the display will NACK with stored
  // counter/fingerprint. rawInputHandler syncs from the NACK, then
  // the retry (250ms later) sends with corrected values.
  function emitWithRetry(buildFn: () => PgnMessage, property: string): void {
    emit(buildFn());
    if (!syncedProperties.has(property)) {
      const timer = setTimeout(() => {
        debug("Retry %s after discovery sync", property);
        emit(buildFn());
      }, 250);
      retryTimers.push(timer);
    }
  }

  const plugin = {
    id: PLUGIN_ID,
    name: "Garmin GNX Keypad",
    description: "Garmin GNX Keypad on NMEA 2000 to control GNX instrument displays",

    schema: {
      type: "object" as const,
      title: "Garmin GNX Keypad",
      properties: {
        sourceAddress: {
          type: "number" as const,
          title: "Source Address",
          description: "NMEA 2000 source address for the keypad (note: the CAN gateway may override this)",
          default: 0,
        },
        groupId: {
          type: "string" as const,
          title: "GNX Group ID (optional)",
          description:
            'Manual override for the 4-byte GNX group binding token (8 hex digits, e.g. "80d99efc"). ' +
            "Leave blank to auto-discover from the first heartbeat or property message on the bus. " +
            "Find it in bytes 10-13 of any PGN 126720 0xe5/0xe7 message on your GNX bus.",
          default: "",
        },
        displayCount: {
          type: "number" as const,
          title: "Display Count (optional)",
          description:
            "Number of GNX displays in the group. Set to 0 to auto-discover from bus traffic. " +
            "Set manually if auto-discovery fails (displays only broadcast count during startup).",
          default: 0,
        },
        fingerprint: {
          type: "string" as const,
          title: "Keypad Fingerprint (optional)",
          description:
            'Manual override for the 2-byte keypad fingerprint (4 hex digits, e.g. "f9a9"). ' +
            "Leave blank to auto-discover from the first property response on the bus. " +
            "Displays reject property commands from a fingerprint that doesn't match their stored value.",
          default: "",
        },
      },
    },

    start: function (props: PluginOptions) {
      options = {
        sourceAddress: props.sourceAddress ?? DEFAULT_SRC,
      };
      sleeping = false;
      displayCount = 0;
      activeDisplay = 0;
      retryTimers = [];
      displayAddresses.clear();
      syncedProperties.clear();
      resetCounters();

      app.emitPropertyValue("canboat-custom-pgns", pgnDefinitions);
      debug("Registered custom PGN definitions");

      if (props.displayCount && props.displayCount > 0) {
        displayCount = props.displayCount;
        debug("Display count set from config: %d", displayCount);
      }

      let fingerprintDiscovered = false;
      const manualFingerprintHex = props.fingerprint?.trim();
      if (manualFingerprintHex && manualFingerprintHex.length === 4) {
        const b1 = parseInt(manualFingerprintHex.slice(0, 2), 16);
        const b2 = parseInt(manualFingerprintHex.slice(2, 4), 16);
        if (!isNaN(b1) && !isNaN(b2)) {
          setFingerprint([b1, b2]);
          fingerprintDiscovered = true;
          debug("Keypad fingerprint set from config: %s", manualFingerprintHex);
        }
      }

      const manualGroupId = props.groupId?.trim();
      let groupIdDiscovered = false;
      if (manualGroupId) {
        try {
          setGroupId(parseGroupId(manualGroupId));
          groupIdDiscovered = true;
          debug("Group ID set from config: %s", manualGroupId);
        } catch (err) {
          debug("Invalid groupId in config, will auto-discover: %s", err);
        }
      }

      // Read raw actisense input BEFORE canboatjs parsing to get full trailing
      // bytes (fingerprint + counter) that canboatjs truncates from the Payload.
      const rawInputHandler = (msg: any) => {
        if (typeof msg !== "string") return;
        const parts = msg.split(",");
        if (parts.length < 9) return;
        if (parseInt(parts[2]) !== PGN_FAST) return;
        const msgSrc = parseInt(parts[3]);
        if (!displayAddresses.has(msgSrc)) return;
        if (parts[6] !== "e5" || parts[8] !== "e5") return;
        if (parseInt(parts[5]) < 40) return;
        const dataBytes = parts.slice(6).map((h: string) => parseInt(h, 16));
        const payload = Buffer.from(dataBytes.slice(3));
        if (payload.length < 20) return;
        const strLen = payload[13];
        if (payload.length < 14 + strLen) return;
        const propName = payload.toString("ascii", 14, 14 + strLen - 1);
        const valueOffset = 14 + strLen + 3;
        if (valueOffset >= payload.length) return;
        const trailingStart = valueOffset + 1;
        if (payload.length < trailingStart + 7) return;
        const t3 = payload[trailingStart + 3];
        const t4 = payload[trailingStart + 4];
        const t5 = payload[trailingStart + 5];
        const t6 = payload[trailingStart + 6];
        const storedSeq = decodeCounter(t5, t6);
        ensureCounterAbove(propName, storedSeq);
        syncedProperties.add(propName);
        debug("Raw counter sync: %s src=%d seq=%d", propName, msgSrc, storedSeq);
        if (!fingerprintDiscovered && (t3 !== 0 || t4 !== 0)) {
          fingerprintDiscovered = true;
          setFingerprint([t3, t4]);
          debug("Fingerprint auto-discovered (raw): %s", t3.toString(16).padStart(2, "0") + t4.toString(16).padStart(2, "0"));
        }
      };
      app.on("canboatjs:rawoutput", rawInputHandler);
      rawInputListener = rawInputHandler;

      const discoveryHandler = (msg: any) => {
        if (msg.pgn !== PGN_FAST) return;
        const fields = msg.fields;
        const mfr = fields?.["Manufacturer Code"];
        if (mfr !== 229 && mfr !== "Garmin") return;
        const cmd = fields?.["Command"];
        if (cmd !== 0xe5 && cmd !== 0xe7) return;
        const payload = parsePayload(fields?.["Payload"]);

        if (!groupIdDiscovered && payload) {
          const groupId = extractGroupIdFromPayload(payload);
          if (groupId) {
            groupIdDiscovered = true;
            setGroupId(groupId);
            const hex = groupId.toString("hex");
            debug("Group ID auto-discovered: %s", hex);
            app.setPluginStatus(`Running — group ${hex}`);
          }
        }

        // Heartbeat payload[13]: 0x01 = display, 0x00 = keypad
        if (cmd === 0xe7 && payload && payload.length >= 14 && payload[13] === 0x01) {
          if (!displayAddresses.has(msg.src)) {
            displayAddresses.add(msg.src);
            debug("Display discovered at src=%d (total: %d)", msg.src, displayAddresses.size);
          }
        }
      };
      app.on("N2KAnalyzerOut", discoveryHandler);
      n2kDiscoveryListener = discoveryHandler;

      const propHandler = (msg: any) => {
        if (msg.pgn !== PGN_FAST) return;
        const fields = msg.fields;
        if (fields?.["Manufacturer Code"] !== 229 && fields?.["Manufacturer Code"] !== "Garmin") return;
        if (fields?.["Command"] !== 0xe5) return;
        const payload = parsePayload(fields?.["Payload"]);
        if (!payload || payload.length < 20) return;

        const strLen = payload[13];
        if (payload.length < 14 + strLen) return;
        const propName = payload.toString("ascii", 14, 14 + strLen - 1);

        const valueOffset = 14 + strLen + 3;
        if (valueOffset >= payload.length) return;
        const value = payload[valueOffset];

        // Extract stored counter and fingerprint from trailing bytes.
        // Trailing 7 bytes: [2e T1 T2 T3(fp1) T4(fp2) T5 T6] — T3/T4 = fingerprint, T5/T6 = counter.
        if (payload.length >= valueOffset + 1 + 7) {
          const trailingStart = valueOffset + 1;
          const t3 = payload[trailingStart + 3];
          const t4 = payload[trailingStart + 4];
          const t5 = payload[payload.length - 2];
          const t6 = payload[payload.length - 1];
          const storedSeq = decodeCounter(t5, t6);
          debug("Counter discovery: %s src=%d stored=%d t5=0x%s t6=0x%s", propName, msg.src, storedSeq, t5.toString(16), t6.toString(16));
          ensureCounterAbove(propName, storedSeq);
          syncedProperties.add(propName);

          if (!fingerprintDiscovered && (t3 !== 0 || t4 !== 0)) {
            fingerprintDiscovered = true;
            setFingerprint([t3, t4]);
            debug("Fingerprint auto-discovered: %s", t3.toString(16).padStart(2, "0") + t4.toString(16).padStart(2, "0"));
          }
        }

        if (propName === PROP_DISP_CNT && value > 0 && displayCount === 0) {
          displayCount = value;
          debug("Display count discovered: %d", displayCount);
        }
        if (propName === PROP_DISPLAY) {
          activeDisplay = value;
          debug("Active display updated: %d", activeDisplay);
        }
      };
      app.on("N2KAnalyzerOut", propHandler);
      propertyListener = propHandler;

      app.setPluginStatus("Started");
      debug("Plugin started, src=%d", src());
    },

    stop: function () {
      retryTimers.forEach((t) => clearTimeout(t));
      retryTimers = [];
      if (n2kDiscoveryListener) {
        app.removeListener("N2KAnalyzerOut", n2kDiscoveryListener);
        n2kDiscoveryListener = null;
      }
      if (propertyListener) {
        app.removeListener("N2KAnalyzerOut", propertyListener);
        propertyListener = null;
      }
      if (rawInputListener) {
        app.removeListener("canboatjs:rawoutput", rawInputListener);
        rawInputListener = null;
      }
      displayAddresses.clear();
      syncedProperties.clear();
      debug("Plugin stopped");
    },

    registerWithRouter: function (router: any) {
      router.use((_req: any, _res: any, next: any) => {
        if (_req.method === "POST") {
          // express.json() may not be available, parse manually if needed
          if (!_req.body && _req.headers["content-type"]?.includes("application/json")) {
            let data = "";
            _req.on("data", (chunk: string) => {
              data += chunk;
            });
            _req.on("end", () => {
              try {
                _req.body = JSON.parse(data);
              } catch {
                _req.body = {};
              }
              next();
            });
            return;
          }
        }
        next();
      });

      router.get("/state", (_req: any, res: any) => {
        const state: PluginState = {
          sleeping,
          displayCount: effectiveDisplayCount(),
          activeDisplay,
        };
        res.json(state);
      });

      router.post("/preset/select", (req: any, res: any) => {
        const index = req.body?.index;
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 3) {
          return res.status(400).json({ error: "index must be an integer 0-3" });
        }
        emit(buildSelectPreset(index, src()));
        res.json({ ok: true });
      });

      router.post("/preset/save", (req: any, res: any) => {
        const index = req.body?.index;
        if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index > 3) {
          return res.status(400).json({ error: "index must be an integer 0-3" });
        }
        emit(buildSavePreset(index, src()));
        res.json({ ok: true });
      });

      router.post("/page", (req: any, res: any) => {
        const direction = req.body?.direction;
        if (direction !== "next" && direction !== "previous") {
          return res.status(400).json({ error: 'direction must be "next" or "previous"' });
        }
        emit(buildPageNav(direction, src()));
        res.json({ ok: true });
      });

      router.post("/display/select", (req: any, res: any) => {
        const index = req.body?.index;
        if (typeof index !== "number" || !Number.isInteger(index)) {
          return res.status(400).json({ error: "index must be an integer" });
        }
        let target = index;
        const count = effectiveDisplayCount();
        if (count > 0) {
          target = ((index % count) + count) % count;
        } else if (index < 0) {
          target = 0;
        }
        emitWithRetry(() => buildDisplaySelect(target, src()), PROP_DISPLAY);
        activeDisplay = target;
        res.json({ ok: true, displayIndex: target });
      });

      router.post("/display/cycle", (req: any, res: any) => {
        const direction = req.body?.direction;
        if (direction !== "up" && direction !== "down") {
          return res.status(400).json({ error: 'direction must be "up" or "down"' });
        }
        let next: number;
        const count = effectiveDisplayCount();
        if (count > 0) {
          const delta = direction === "down" ? 1 : -1;
          next = (((activeDisplay + delta) % count) + count) % count;
        } else {
          next = direction === "down" ? activeDisplay + 1 : Math.max(0, activeDisplay - 1);
        }
        emitWithRetry(() => buildDisplaySelect(next, src()), PROP_DISPLAY);
        activeDisplay = next;
        res.json({ ok: true, displayIndex: next });
      });

      router.post("/power", (req: any, res: any) => {
        const action = req.body?.action;
        if (action !== "sleep" && action !== "wake") {
          return res.status(400).json({ error: 'action must be "sleep" or "wake"' });
        }
        const goToSleep = action === "sleep";
        emitWithRetry(() => buildSleepWake(goToSleep, src()), PROP_SLEEP);
        sleeping = goToSleep;
        res.json({ ok: true });
      });
    },
  };

  return plugin
}
