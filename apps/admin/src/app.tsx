// Shell of the internal admin console (Req 8.1, 8.2, 8.4, 8.5): the one h1, the stream status in
// the header, a left nav for the pages and the page switch. Its requests are the Operator_Stream,
// the twelve Operator_Content_Routes and the Device_Control_Route, all at its own origin and all
// through `content/content-client.ts` or `control/control-client.ts`, the console's only two
// `fetch` call sites (Phase 4 Req 17.7; Phase 6 C10).
// No env read, no Panel_Key name, no URL literal. Nothing here animates.
import { ContentPage } from "./pages/content-page";
import { ControlPage } from "./pages/control-page";
import { ConversationPage } from "./pages/conversation-page";
import { DashboardPage } from "./pages/dashboard-page";
import { DevicesPage } from "./pages/devices-page";
import { LiveLogPage } from "./pages/live-log-page";
import { MatrixPage } from "./pages/matrix-page";
import type { ContentClient } from "./content/content-client";
import type { ControlClient } from "./control/control-client";
import { PAGE_HASHES, useHashPage } from "./routing/use-hash-page";
import type { ConsolePage } from "./routing/use-hash-page";
import { StreamStatus } from "./components/stream-status";
import { browserEventSource, useConsoleStream } from "./stream/use-console-stream";
import type { CreateSource } from "./stream/use-console-stream";

export type AppProps = Readonly<{
  /** Builds each connection's source; the browser's EventSource unless a test passes a fake. */
  createSource?: CreateSource;
  /** The Content page's client; the browser's `fetch` unless a test passes a fake. */
  contentClient?: ContentClient;
  /**
   * The Device_Control_Route client, shared by the Test Matrix's driven rows and the Device
   * Control page; the browser's `fetch` unless a test passes a fake.
   */
  controlClient?: ControlClient;
}>;

const NAV_ITEMS: readonly Readonly<{ page: ConsolePage; label: string }>[] = [
  { page: "dashboard", label: "Dashboard" },
  { page: "devices", label: "Devices" },
  { page: "matrix", label: "Test matrix" },
  { page: "control", label: "Device control" },
  { page: "live", label: "Devices and live log" },
  { page: "conversation", label: "Conversation" },
  { page: "content", label: "Content and AI" },
];

export function App({ createSource = browserEventSource, contentClient, controlClient }: AppProps) {
  const state = useConsoleStream(createSource);
  const page = useHashPage();

  return (
    <div className="console">
      <header className="console-header">
        <h1>Xelulu developer console</h1>
        <StreamStatus connection={state.connection} stale={state.stale} />
      </header>
      <div className="console-body">
        <nav className="console-nav" aria-label="Console pages">
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.page}>
                <a
                  href={PAGE_HASHES[item.page]}
                  aria-current={item.page === page ? "page" : undefined}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <main className="console-main">
          {page === "devices" ? (
            <DevicesPage devices={state.devices} entries={state.entries} />
          ) : page === "matrix" ? (
            <MatrixPage
              {...(controlClient === undefined ? {} : { client: controlClient })}
              devices={state.devices}
              entries={state.entries}
            />
          ) : page === "control" ? (
            <ControlPage
              {...(controlClient === undefined ? {} : { client: controlClient })}
              devices={state.devices}
              entries={state.entries}
            />
          ) : page === "live" ? (
            <LiveLogPage devices={state.devices} entries={state.entries} />
          ) : page === "conversation" ? (
            <ConversationPage turns={state.turns} />
          ) : page === "content" ? (
            // The device id comes from the stream's own device list, so the page guesses none.
            <ContentPage
              {...(contentClient === undefined ? {} : { client: contentClient })}
              deviceId={state.devices?.[0]?.device_id ?? null}
            />
          ) : (
            <DashboardPage devices={state.devices} />
          )}
        </main>
      </div>
    </div>
  );
}
