// Shell of the internal admin console (Req 8.1, 8.2, 8.4, 8.5): the one h1, the stream status in
// the header, a left nav for the three pages and the page switch. The console is read-only: its
// only request is the Operator_Stream at its own origin (`/v1/stream`, opened by the stream
// hook). No env read, no Panel_Key name, no URL literal. Nothing here animates.
import { ConversationPage } from "./pages/conversation-page";
import { DashboardPage } from "./pages/dashboard-page";
import { LiveLogPage } from "./pages/live-log-page";
import { PAGE_HASHES, useHashPage } from "./routing/use-hash-page";
import type { ConsolePage } from "./routing/use-hash-page";
import { StreamStatus } from "./components/stream-status";
import { browserEventSource, useConsoleStream } from "./stream/use-console-stream";
import type { CreateSource } from "./stream/use-console-stream";

export type AppProps = Readonly<{
  /** Builds each connection's source; the browser's EventSource unless a test passes a fake. */
  createSource?: CreateSource;
}>;

const NAV_ITEMS: readonly Readonly<{ page: ConsolePage; label: string }>[] = [
  { page: "dashboard", label: "Dashboard" },
  { page: "live", label: "Devices and live log" },
  { page: "conversation", label: "Conversation" },
];

export function App({ createSource = browserEventSource }: AppProps) {
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
          {page === "live" ? (
            <LiveLogPage devices={state.devices} entries={state.entries} />
          ) : page === "conversation" ? (
            <ConversationPage turns={state.turns} />
          ) : (
            <DashboardPage devices={state.devices} />
          )}
        </main>
      </div>
    </div>
  );
}
