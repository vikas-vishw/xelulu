// Simulator entry point (Req 1.3, 20.1, 21.3, 21.6, D15). Process warnings are silenced first, so
// nothing but the config error line ever reaches stderr. The Config is read through env.ts before
// anything else: a refused Config writes the config error line and exits 2 with no socket opened.
// Then the crash and signal handlers are installed (the fatal exit waits for stdout to drain), the
// real transports are wired in and the simulator starts; the Listen_All_Argument, if present,
// lets the Control_Surface bind 0.0.0.0 in Local_Mode (Phase 1.3 C8). Any start failure, including a
// Control_Surface that cannot listen, is fatal: one `simulator` `crashed` entry with no error
// text, exit 1.
process.removeAllListeners("warning");

import { openWsAudio } from "./audio/transport/ws-audio-client.js";
import { systemClock } from "./clock.js";
import { writeConfigError } from "./config-error-writer.js";
import { listenControlHttp } from "./control/transport/http-listener.js";
import { installProcessHandlers } from "./crash.js";
import { readSimulatorConfig } from "./env.js";
import { randomIds } from "./ids.js";
import { hasListenAllArgument } from "./listen-host.js";
import { flushStdout, stdoutSink } from "./log/logger.js";
import { mqttJsConnector } from "./mqtt/transport/mqtt-js-connector.js";
import { createSimulator } from "./simulator.js";

/** Exit code for a refused Config (D15). */
const EXIT_CONFIG_ERROR = 2;

const result = readSimulatorConfig();
if (!result.ok) {
  writeConfigError(result.offendingKeys);
  // Nothing else is pending, so the process ends at once with this code.
  process.exitCode = EXIT_CONFIG_ERROR;
} else {
  const simulator = createSimulator(result.config, {
    clock: systemClock,
    connectMqtt: mqttJsConnector,
    openAudio: openWsAudio,
    listenControl: listenControlHttp,
    sink: stdoutSink,
    ids: randomIds,
    // Other arguments stay ignored (Phase 1.3 C8).
    listenAllInterfaces: hasListenAllArgument(process.argv.slice(2)),
  });
  installProcessHandlers(
    process,
    () => {
      simulator.log.add({ kind: "simulator", state: "crashed" });
    },
    () => simulator.stop(),
    flushStdout,
  );
  simulator.start().catch(() => {
    // The cause is dropped unread; the rejection reaches the fatal handler, which writes the one
    // `crashed` entry and exits 1.
    throw new Error();
  });
}
