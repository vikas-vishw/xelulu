// Gateway entry point (Req 1.3, 13.8, 21.3, 21.6, D15). Process warnings are silenced first, so
// nothing but the two allowed lines ever reaches stderr. The Config is read through env.ts before
// anything else: a refused Config writes the config error line and exits 2 with no socket opened.
// Then the crash and signal handlers are installed, the real transports are wired in and the
// gateway starts. The only argument read is the Listen_All_Argument (Phase 1.3 Req 3.1): in
// Local_Mode it binds the Operator_Surface on 0.0.0.0, else 127.0.0.1. An Operator_Surface that cannot listen writes the listen error line and exits 3.
// Any other failure is fatal: one `gateway` `stopping` entry with no error text, exit 1.
process.removeAllListeners("warning");

import { listenWsAudio } from "./audio/transport/ws-audio-listener.js";
import { systemClock } from "./clock.js";
import { writeConfigError, writeListenError, writeProviderError } from "./config-error-writer.js";
import { installProcessHandlers } from "./crash.js";
import { readGatewayConfig } from "./env.js";
import { createGateway, OperatorListenError, ProviderRefusedError } from "./gateway.js";
import { randomIds } from "./ids.js";
import {
  contentAdminEnabled,
  hasListenAllArgument,
  operatorTranscriptsEnabled,
} from "./listen-host.js";
import { flushStdout, stdoutSink } from "./log/logger.js";
import { mqttJsConnector } from "./mqtt/transport/mqtt-js-connector.js";
import { listenOperatorHttp } from "./operator/transport/http-listener.js";

/** Exit codes (D15). */
const EXIT_CONFIG_ERROR = 2;
const EXIT_LISTEN_ERROR = 3;
/** A provider that cannot declare no retention and no training (Phase 3 Req 1.4, C8). */
const EXIT_PROVIDER_REFUSED = 4;
/** Upper bound on the wait for stderr to drain before a listen-error exit. */
const EXIT_GRACE_MS = 1_000;

const result = readGatewayConfig();
if (!result.ok) {
  writeConfigError(result.offendingKeys);
  // Nothing else is pending, so the process ends at once with this code.
  process.exitCode = EXIT_CONFIG_ERROR;
} else {
  const gateway = createGateway(result.config, {
    clock: systemClock,
    connectMqtt: mqttJsConnector,
    listenAudio: listenWsAudio,
    listenOperator: listenOperatorHttp,
    sink: stdoutSink,
    ids: randomIds,
    listenAllInterfaces: hasListenAllArgument(process.argv.slice(2)),
    // Local_Mode only, and off unless asked for: outside Local_Mode the argument is ignored
    // entirely, so a hosted gateway cannot be made to emit a child's words (Phase 3 C4).
    operatorTranscripts: operatorTranscriptsEnabled(result.config.localMode, process.argv.slice(2)),
    // Local_Mode only, and off unless asked for: without it every Operator_Content_Route write
    // answers 403 before it reads a body byte (Phase 4 C23).
    contentAdmin: contentAdminEnabled(result.config.localMode, process.argv.slice(2)),
  });
  installProcessHandlers(
    process,
    () => {
      gateway.log.add({ kind: "gateway", state: "stopping" });
    },
    () => gateway.stop(),
    flushStdout,
  );
  gateway.start().catch((err: unknown) => {
    if (err instanceof ProviderRefusedError) {
      // One line naming the capability and the provider id, and no listener was opened.
      writeProviderError(err.capability, err.provider);
      process.exitCode = EXIT_PROVIDER_REFUSED;
      setTimeout(() => process.exit(EXIT_PROVIDER_REFUSED), EXIT_GRACE_MS).unref();
      return;
    }
    if (!(err instanceof OperatorListenError)) throw err;
    writeListenError();
    process.exitCode = EXIT_LISTEN_ERROR;
    setTimeout(() => process.exit(EXIT_LISTEN_ERROR), EXIT_GRACE_MS).unref();
  });
}
