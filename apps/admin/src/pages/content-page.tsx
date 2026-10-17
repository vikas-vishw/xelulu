// The Content page (Req 17.1–17.6, 17.8): the curated library, Grandma's recordings and consent
// records, the day's routines and the two report summaries — the four Operator_Content_Route reads
// — plus the eight writes, which exist only where the Gateway runs with the Content_Admin_Argument.
//
// Where `write_enabled` is false the page renders NO write control and says so in one line naming
// the argument (Req 17.5). A refused write shows the refusal's code, its field path and any gate
// verdict as text and changes nothing the page holds; a write whose response is not this surface's
// JSON shows `proxy_disabled` rather than a silent success (Req 17.6, 17.6a).
import { useCallback, useEffect, useId, useMemo, useReducer } from "react";
import type { ChangeEvent } from "react";

import type { ContentStatus } from "@xelulu/shared";

import { ContentEditor } from "../components/content-editor";
import { ContentTable } from "../components/content-table";
import { GrandmaList } from "../components/grandma-list";
import {
  createContentClient,
  type ClientResult,
  type ConsentInput,
  type ContentClient,
  type RecordingInput,
  type WriteBody,
} from "../content/content-client";
import {
  CONTENT_SECTIONS,
  contentReducer,
  INITIAL_CONTENT_STATE,
  itemsInSection,
  refusalText,
  type ContentSection,
} from "../content/content-state";

export type ContentPageProps = Readonly<{
  /** The browser's client unless a test passes a fake; the console's only request path. */
  client?: ContentClient;
  /**
   * The device a manual routine run and a Grandma call are sent to, from the Operator_Stream's
   * own device list (app.tsx holds it). Null until the first `devices` event, and the two
   * controls that need it are not rendered until it arrives — the console guesses no device id.
   */
  deviceId?: string | null;
}>;

/** The one line shown where the write path is off (Req 17.5). */
export const WRITES_OFF_TEXT =
  "Writes are off. Start the gateway with --content-admin in local mode to enable them.";

function toSection(value: string): ContentSection {
  return CONTENT_SECTIONS.find((section) => section === value) ?? "Stories";
}

export function ContentPage({ client, deviceId = null }: ContentPageProps) {
  const headingId = useId();
  const filterId = useId();
  const resolved = useMemo(() => client ?? createContentClient(), [client]);
  const [state, dispatch] = useReducer(contentReducer, INITIAL_CONTENT_STATE);

  const loadContent = useCallback(async () => {
    const result = await resolved.content();
    if (result.ok) dispatch({ type: "content", body: result.value });
    else dispatch({ type: "refused", refusal: result.refusal });
  }, [resolved]);

  const loadGrandma = useCallback(async () => {
    const result = await resolved.grandma();
    if (result.ok) dispatch({ type: "grandma", body: result.value });
    else dispatch({ type: "refused", refusal: result.refusal });
  }, [resolved]);

  const loadRoutines = useCallback(async () => {
    const result = await resolved.routines();
    if (result.ok) dispatch({ type: "routines", body: result.value });
    else dispatch({ type: "refused", refusal: result.refusal });
  }, [resolved]);

  const loadReports = useCallback(async () => {
    const result = await resolved.reports();
    if (result.ok) dispatch({ type: "reports", body: result.value });
    else dispatch({ type: "refused", refusal: result.refusal });
  }, [resolved]);

  useEffect(() => {
    void loadContent();
    void loadGrandma();
    void loadRoutines();
    void loadReports();
  }, [loadContent, loadGrandma, loadRoutines, loadReports]);

  /** A write, then a re-read of what it changed (Req 16.12, 17.6). */
  const write = useCallback(
    async (
      run: () => Promise<ClientResult<WriteBody>>,
      note: string,
      reread: () => Promise<void>,
    ) => {
      dispatch({ type: "pending" });
      const result = await run();
      if (!result.ok) {
        dispatch({ type: "refused", refusal: result.refusal });
        return;
      }
      dispatch({ type: "wrote", note });
      await reread();
    },
    [],
  );

  const openItem = useCallback(
    async (contentId: string) => {
      const result = await resolved.contentItem(contentId);
      if (result.ok) dispatch({ type: "editing", body: result.value });
      else dispatch({ type: "refused", refusal: result.refusal });
    },
    [resolved],
  );

  const onSetStatus = (contentId: string, status: ContentStatus): void => {
    void write(
      () => resolved.setStatus(contentId, status),
      `Status of ${contentId} set to ${status}.`,
      loadContent,
    );
  };

  const onCreate = (draft: Readonly<Record<string, unknown>>): void => {
    void write(() => resolved.createContent(draft), "Draft saved.", loadContent);
  };

  const onUpdate = (contentId: string, patch: Readonly<Record<string, unknown>>): void => {
    void write(() => resolved.updateContent(contentId, patch), "Draft updated.", loadContent);
  };

  const onAddConsent = (input: ConsentInput): void => {
    void write(() => resolved.addConsent(input), "Consent record created.", loadGrandma);
  };

  const onAddRecording = (input: RecordingInput): void => {
    void write(() => resolved.addRecording(input), "Recording added.", loadGrandma);
  };

  const onSchedule = (assetId: string, at: string, enabled: boolean): void => {
    void write(
      () => resolved.scheduleRecording(assetId, at, enabled),
      "Schedule saved.",
      loadGrandma,
    );
  };

  const onRun = (routineId: string): void => {
    if (deviceId === null) return;
    void write(
      () => resolved.runRoutine(deviceId, routineId),
      `Routine ${routineId} run through the policy gate.`,
      loadRoutines,
    );
  };

  const onCall = (op: string): void => {
    if (deviceId === null) return;
    void write(() => resolved.call(deviceId, op), `Call ${op} applied.`, loadGrandma);
  };

  const onSectionChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    dispatch({ type: "section", section: toSection(event.target.value) });
  };

  const items = state.items ?? [];
  const shown = itemsInSection(items, state.section);
  const writeEnabled = state.writeEnabled;

  return (
    <section className="page content-page" aria-labelledby={headingId}>
      <h2 id={headingId}>Content and AI</h2>
      <div className="live-log-filter">
        <label htmlFor={filterId}>Section</label>
        <select id={filterId} value={state.section} onChange={onSectionChange}>
          {CONTENT_SECTIONS.map((section) => (
            <option key={section} value={section}>
              {section}
            </option>
          ))}
        </select>
      </div>
      {writeEnabled ? null : <p className="content-writes-off">{WRITES_OFF_TEXT}</p>}
      {state.note === null ? null : <p className="content-note">{state.note}</p>}
      {state.refusal === null ? null : (
        <p className="content-refusal">Refused: {refusalText(state.refusal)}</p>
      )}

      {state.section === "Grandma" ? (
        state.grandma === null ? (
          <p className="content-empty">Waiting for Grandma data.</p>
        ) : (
          <GrandmaList
            body={state.grandma}
            writeEnabled={writeEnabled}
            callDeviceId={deviceId}
            onAddConsent={onAddConsent}
            onAddRecording={onAddRecording}
            onSchedule={onSchedule}
            onCall={onCall}
          />
        )
      ) : state.items === null ? (
        <p className="content-empty">Waiting for content.</p>
      ) : shown.length === 0 ? (
        <p className="content-empty">No items in this section.</p>
      ) : (
        <ContentTable
          items={shown}
          caption={state.section}
          {...(writeEnabled
            ? {
                onOpen: (contentId: string) => {
                  void openItem(contentId);
                },
                onSetStatus,
              }
            : {})}
        />
      )}

      {writeEnabled && state.section !== "Grandma" ? (
        <ContentEditor
          key={state.editing?.item.content_id ?? "new"}
          editing={state.editing}
          onCreate={onCreate}
          onUpdate={onUpdate}
          onClose={() => dispatch({ type: "editing", body: null })}
        />
      ) : null}

      <section className="content-routines" aria-label="Routines">
        <h3>Routines</h3>
        {state.routines === null ? (
          <p className="content-empty">Waiting for routines.</p>
        ) : (
          <>
            <p>Play minutes used today: {state.routines.play_minutes_used}</p>
            <table className="content-table">
              <caption>Today</caption>
              <thead>
                <tr>
                  <th scope="col">Routine</th>
                  <th scope="col">Time</th>
                  <th scope="col">Enabled</th>
                  <th scope="col">Actions</th>
                  <th scope="col">Fired today</th>
                  {writeEnabled && deviceId !== null ? <th scope="col">Run</th> : null}
                </tr>
              </thead>
              <tbody>
                {state.routines.routines.map((routine) => (
                  <tr key={routine.routine_id}>
                    <th scope="row">{routine.name}</th>
                    <td>{routine.at}</td>
                    <td>{routine.enabled ? "Yes" : "No"}</td>
                    <td>{routine.actions}</td>
                    <td>{routine.fired_today ? "Yes" : "No"}</td>
                    {writeEnabled && deviceId !== null ? (
                      <td>
                        <button type="button" onClick={() => onRun(routine.routine_id)}>
                          Run {routine.name}
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="content-reports" aria-label="Reports">
        <h3>Reports</h3>
        {state.reports === null ? (
          <p className="content-empty">Waiting for reports.</p>
        ) : (
          <dl className="turn-fields">
            <div className="turn-field">
              <dt className="turn-term">Turns today</dt>
              <dd className="turn-value">{state.reports.daily.turns}</dd>
            </div>
            <div className="turn-field">
              <dt className="turn-term">Play minutes today</dt>
              <dd className="turn-value">{state.reports.daily.play_minutes}</dd>
            </div>
            <div className="turn-field">
              <dt className="turn-term">Stories this week</dt>
              <dd className="turn-value">{state.reports.weekly.stories_heard}</dd>
            </div>
            <div className="turn-field">
              <dt className="turn-term">Routines this week</dt>
              <dd className="turn-value">{state.reports.weekly.routines_completed}</dd>
            </div>
          </dl>
        )}
        <p className="content-form-note">
          Reports are summaries a parent asks for: counts only, with no profile and no inference.
        </p>
      </section>
    </section>
  );
}
