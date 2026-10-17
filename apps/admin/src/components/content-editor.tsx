// The Content editor (Req 17.4, 17.8): the labelled add/edit form, rendered only where
// `write_enabled` is true. Every control has a `<label>` tied to it by id, and every list field is
// a comma-separated line because this is an internal tool for a handful of short items — the
// route-submitted draft is bounded by the surface's unchanged 8 KiB body cap (Req 16.13).
//
// It submits what the route accepts and nothing else: no `status` (only the Active/Draft control
// reaches a status, through the Content_Gate), no `household_id` and no times, all of which the
// store owns. The spoken steps are submitted as JSON, which is the honest shape for a dev console;
// the parent app's real editor arrives with Phase 5.
import { useId, useState } from "react";

import { CONTENT_KINDS, CONTENT_SOURCES } from "@xelulu/shared";

import type { ContentItemBody } from "../content/content-client";

export type ContentEditorProps = Readonly<{
  /** The one item the operator opened, in full, or null to add a new draft. */
  editing: ContentItemBody | null;
  onCreate: (draft: Readonly<Record<string, unknown>>) => void;
  onUpdate: (contentId: string, patch: Readonly<Record<string, unknown>>) => void;
  onClose: () => void;
}>;

/** A comma-separated line to a list, trimmed, with empty entries dropped. */
function toList(value: string): string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

export function ContentEditor({ editing, onCreate, onUpdate, onClose }: ContentEditorProps) {
  const item = editing?.item ?? null;
  const ids = {
    contentId: useId(),
    title: useId(),
    kind: useId(),
    languages: useId(),
    ageStages: useId(),
    categories: useId(),
    licence: useId(),
    source: useId(),
    steps: useId(),
  };

  const [contentId, setContentId] = useState(item?.content_id ?? "");
  const [title, setTitle] = useState(item?.title ?? "");
  const [kind, setKind] = useState<string>(item?.kind ?? "story");
  const [languages, setLanguages] = useState((item?.languages ?? ["en-IN"]).join(", "));
  const [ageStages, setAgeStages] = useState((item?.age_stages ?? ["little"]).join(", "));
  const [categories, setCategories] = useState((item?.categories ?? ["stories"]).join(", "));
  const [licence, setLicence] = useState(item?.licence_note ?? "");
  const [source, setSource] = useState<string>(item?.source ?? "original");
  const [steps, setSteps] = useState(item === null ? "[]" : JSON.stringify(item.steps, null, 2));
  const [stepsError, setStepsError] = useState<string | null>(null);

  function submit(): void {
    let parsedSteps: unknown;
    try {
      parsedSteps = JSON.parse(steps);
    } catch {
      setStepsError("Steps must be JSON.");
      return;
    }
    setStepsError(null);
    const fields: Record<string, unknown> = {
      kind,
      title,
      languages: toList(languages),
      age_stages: toList(ageStages),
      categories: toList(categories),
      licence_note: licence,
      source,
      steps: parsedSteps,
    };
    if (item === null) onCreate({ content_id: contentId, ...fields });
    else onUpdate(item.content_id, fields);
  }

  return (
    <form
      className="content-form"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h3>{item === null ? "Add a draft" : `Edit ${item.title}`}</h3>
      <p className="content-form-note">
        A new or edited item is always saved as a draft. Activating it runs the output safety guard
        first.
      </p>
      {item === null ? (
        <div className="content-field">
          <label htmlFor={ids.contentId}>Content id</label>
          <input
            id={ids.contentId}
            value={contentId}
            onChange={(event) => setContentId(event.target.value)}
          />
        </div>
      ) : null}
      <div className="content-field">
        <label htmlFor={ids.title}>Title</label>
        <input id={ids.title} value={title} onChange={(event) => setTitle(event.target.value)} />
      </div>
      <div className="content-field">
        <label htmlFor={ids.kind}>Kind</label>
        <select id={ids.kind} value={kind} onChange={(event) => setKind(event.target.value)}>
          {CONTENT_KINDS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <div className="content-field">
        <label htmlFor={ids.languages}>Languages (comma separated)</label>
        <input
          id={ids.languages}
          value={languages}
          onChange={(event) => setLanguages(event.target.value)}
        />
      </div>
      <div className="content-field">
        <label htmlFor={ids.ageStages}>Age stages (comma separated)</label>
        <input
          id={ids.ageStages}
          value={ageStages}
          onChange={(event) => setAgeStages(event.target.value)}
        />
      </div>
      <div className="content-field">
        <label htmlFor={ids.categories}>Categories (comma separated)</label>
        <input
          id={ids.categories}
          value={categories}
          onChange={(event) => setCategories(event.target.value)}
        />
      </div>
      <div className="content-field">
        <label htmlFor={ids.licence}>Licence note</label>
        <input
          id={ids.licence}
          value={licence}
          onChange={(event) => setLicence(event.target.value)}
        />
      </div>
      <div className="content-field">
        <label htmlFor={ids.source}>Source</label>
        <select id={ids.source} value={source} onChange={(event) => setSource(event.target.value)}>
          {CONTENT_SOURCES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
      <div className="content-field">
        <label htmlFor={ids.steps}>Steps (JSON)</label>
        <textarea
          id={ids.steps}
          rows={8}
          value={steps}
          onChange={(event) => setSteps(event.target.value)}
        />
      </div>
      {stepsError === null ? null : <p className="content-refusal">{stepsError}</p>}
      <div className="content-form-actions">
        <button type="submit">{item === null ? "Save draft" : "Save changes"}</button>{" "}
        <button type="button" onClick={onClose}>
          Close editor
        </button>
      </div>
    </form>
  );
}
