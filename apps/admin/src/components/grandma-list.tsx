// The Grandma section (Req 17.3, 17.4, 17.8): the household's recordings, its Consent_Records,
// and — where `write_enabled` is true — the add-consent, add-recording and schedule controls.
//
// A recording row shows its title, kind, language, duration, status, schedule and whether a live
// Consent_Record backs it, and NO Media_Handle: the surface does not send one and this component
// could not show one (Req 7.5, 16.10). A Consent_Record row is an id, a purpose, a version, a
// verification method and two times — there is no name, contact detail or identity document in
// the Consent_Store to show (Req 6.4).
//
// WHAT THE ADD-CONSENT CONTROL IS NOT (Req 6.7). It records the SHAPE of a consent record for
// development, against an in-process dev user, on an unauthenticated loopback surface. It is not
// verifiable parental consent under the DPDP Act, and the label and helper text say so.
import { useId, useState } from "react";

import {
  CONSENT_PURPOSES,
  GRANDMA_ASSET_KINDS,
  SUPPORTED_LANGS,
  VERIFICATION_METHODS,
} from "@xelulu/shared";

import type { ConsentInput, GrandmaBody, RecordingInput } from "../content/content-client";

export type GrandmaListProps = Readonly<{
  body: GrandmaBody;
  writeEnabled: boolean;
  /** From the Operator_Stream's device list; null until it arrives, and then no call control. */
  callDeviceId: string | null;
  onAddConsent: (input: ConsentInput) => void;
  onAddRecording: (input: RecordingInput) => void;
  onSchedule: (assetId: string, at: string, enabled: boolean) => void;
  onCall: (op: string) => void;
}>;

/** The four operations `POST /v1/grandma/call` accepts. The Gateway owns the transitions. */
const CALL_OPS: readonly string[] = ["request", "accept", "decline", "end"];

/** The one sentence that must never read as "DPDP consent is done" (Req 6.7, F7). */
export const CONSENT_HELPER_TEXT =
  "This records a consent record for development only. It is not verifiable parental consent" +
  " under the DPDP Act, which arrives in Phase 5.";

function AddConsent({ onAddConsent }: Pick<GrandmaListProps, "onAddConsent">) {
  const purposeId = useId();
  const versionId = useId();
  const methodId = useId();
  const helperId = useId();
  const [purpose, setPurpose] = useState<string>(CONSENT_PURPOSES[0]);
  const [version, setVersion] = useState("dev-notice-1");
  const [method, setMethod] = useState<string>(VERIFICATION_METHODS[0]);

  return (
    <form
      className="content-form"
      onSubmit={(event) => {
        event.preventDefault();
        onAddConsent({ purpose, version, verification_method: method });
      }}
    >
      <h4>Record a development consent record</h4>
      <p className="content-form-note" id={helperId}>
        {CONSENT_HELPER_TEXT}
      </p>
      <div className="content-field">
        <label htmlFor={purposeId}>Purpose</label>
        <select
          id={purposeId}
          value={purpose}
          aria-describedby={helperId}
          onChange={(event) => setPurpose(event.target.value)}
        >
          {CONSENT_PURPOSES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <div className="content-field">
        <label htmlFor={versionId}>Notice version</label>
        <input
          id={versionId}
          value={version}
          onChange={(event) => setVersion(event.target.value)}
        />
      </div>
      <div className="content-field">
        <label htmlFor={methodId}>Verification method</label>
        <select id={methodId} value={method} onChange={(event) => setMethod(event.target.value)}>
          {VERIFICATION_METHODS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <div className="content-form-actions">
        <button type="submit">Record development consent</button>
      </div>
    </form>
  );
}

function AddRecording({ body, onAddRecording }: Pick<GrandmaListProps, "body" | "onAddRecording">) {
  const consentId = useId();
  const kindId = useId();
  const titleId = useId();
  const langId = useId();
  const durationId = useId();
  const [consent, setConsent] = useState(body.consents[0]?.consent_id ?? "");
  const [kind, setKind] = useState<string>(GRANDMA_ASSET_KINDS[0]);
  const [title, setTitle] = useState("");
  const [lang, setLang] = useState<string>(SUPPORTED_LANGS[0]);
  const [duration, setDuration] = useState("120");

  return (
    <form
      className="content-form"
      onSubmit={(event) => {
        event.preventDefault();
        onAddRecording({
          consent_record_id: consent,
          kind,
          title,
          lang,
          duration_s: Number(duration),
        });
      }}
    >
      <h4>Add a recording</h4>
      <p className="content-form-note">
        A recording is metadata only. No audio is uploaded, stored or played back by the console.
      </p>
      <div className="content-field">
        <label htmlFor={consentId}>Consent record</label>
        <select id={consentId} value={consent} onChange={(event) => setConsent(event.target.value)}>
          {body.consents.length === 0 ? <option value="">No consent record yet</option> : null}
          {body.consents.map((record) => (
            <option key={record.consent_id} value={record.consent_id}>
              {record.consent_id}
            </option>
          ))}
        </select>
      </div>
      <div className="content-field">
        <label htmlFor={kindId}>Kind</label>
        <select id={kindId} value={kind} onChange={(event) => setKind(event.target.value)}>
          {GRANDMA_ASSET_KINDS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <div className="content-field">
        <label htmlFor={titleId}>Title</label>
        <input id={titleId} value={title} onChange={(event) => setTitle(event.target.value)} />
      </div>
      <div className="content-field">
        <label htmlFor={langId}>Language</label>
        <select id={langId} value={lang} onChange={(event) => setLang(event.target.value)}>
          {SUPPORTED_LANGS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <div className="content-field">
        <label htmlFor={durationId}>Duration in seconds</label>
        <input
          id={durationId}
          inputMode="numeric"
          value={duration}
          onChange={(event) => setDuration(event.target.value)}
        />
      </div>
      <div className="content-form-actions">
        <button type="submit">Add recording</button>
      </div>
    </form>
  );
}

function ScheduleForm({ body, onSchedule }: Pick<GrandmaListProps, "body" | "onSchedule">) {
  const assetId = useId();
  const atId = useId();
  const enabledId = useId();
  const [asset, setAsset] = useState(body.recordings[0]?.asset_id ?? "");
  const [at, setAt] = useState("19:30");
  const [enabled, setEnabled] = useState(true);

  return (
    <form
      className="content-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSchedule(asset, at, enabled);
      }}
    >
      <h4>Schedule a recording</h4>
      <div className="content-field">
        <label htmlFor={assetId}>Recording</label>
        <select id={assetId} value={asset} onChange={(event) => setAsset(event.target.value)}>
          {body.recordings.length === 0 ? <option value="">No recording yet</option> : null}
          {body.recordings.map((recording) => (
            <option key={recording.asset_id} value={recording.asset_id}>
              {recording.title}
            </option>
          ))}
        </select>
      </div>
      <div className="content-field">
        <label htmlFor={atId}>Local time (HH:MM)</label>
        <input id={atId} value={at} onChange={(event) => setAt(event.target.value)} />
      </div>
      <div className="content-field">
        <label htmlFor={enabledId}>Enabled</label>
        <input
          id={enabledId}
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
        />
      </div>
      <div className="content-form-actions">
        <button type="submit">Save schedule</button>
      </div>
    </form>
  );
}

export function GrandmaList({
  body,
  writeEnabled,
  callDeviceId,
  onAddConsent,
  onAddRecording,
  onSchedule,
  onCall,
}: GrandmaListProps) {
  return (
    <div className="grandma-section">
      <table className="content-table">
        <caption>Grandma recordings</caption>
        <thead>
          <tr>
            <th scope="col">Title</th>
            <th scope="col">Kind</th>
            <th scope="col">Language</th>
            <th scope="col">Duration</th>
            <th scope="col">Status</th>
            <th scope="col">Schedule</th>
            <th scope="col">Consent</th>
          </tr>
        </thead>
        <tbody>
          {body.recordings.map((recording) => (
            <tr key={recording.asset_id}>
              <th scope="row">{recording.title}</th>
              <td>{recording.kind}</td>
              <td>{recording.lang}</td>
              <td>{recording.duration_s} s</td>
              <td>{recording.status}</td>
              <td>
                {recording.schedule === null
                  ? "Not scheduled"
                  : `${recording.schedule.at} ${recording.schedule.enabled ? "on" : "off"}`}
              </td>
              <td>{recording.consent_live ? "Live consent" : "No live consent"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {body.recordings.length === 0 ? <p className="content-empty">No recordings yet.</p> : null}

      <table className="content-table">
        <caption>Consent records</caption>
        <thead>
          <tr>
            <th scope="col">Consent id</th>
            <th scope="col">Purpose</th>
            <th scope="col">Version</th>
            <th scope="col">Given</th>
            <th scope="col">Withdrawn</th>
          </tr>
        </thead>
        <tbody>
          {body.consents.map((record) => (
            <tr key={record.consent_id}>
              <th scope="row">{record.consent_id}</th>
              <td>{record.purpose}</td>
              <td>{record.version}</td>
              <td>
                <time dateTime={record.given_at}>{record.given_at}</time>
              </td>
              <td>{record.withdrawn_at ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {body.consents.length === 0 ? <p className="content-empty">No consent records yet.</p> : null}

      <p className="content-call-state">
        Live call: {body.call === null ? "none" : `${body.call.state} (${body.call.call_id})`}
      </p>

      {writeEnabled ? (
        <>
          <AddConsent onAddConsent={onAddConsent} />
          <AddRecording body={body} onAddRecording={onAddRecording} />
          <ScheduleForm body={body} onSchedule={onSchedule} />
          {callDeviceId === null ? null : (
            <div className="content-form-actions" role="group" aria-label="Grandma call">
              {CALL_OPS.map((op) => (
                <button key={op} type="button" onClick={() => onCall(op)}>
                  Call {op}
                </button>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
