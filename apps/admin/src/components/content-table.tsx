// The Content table (Req 17.2, 17.8): one semantic table of the `GET /v1/content` summaries for
// the chosen section, with a caption and column headers. It shows exactly what the summary
// carries — never a step text or a choice prompt, which live in the editor for the one item the
// operator opened. Status is text, never colour alone, and nothing here animates.
import type { ContentStatus } from "@xelulu/shared";

import type { ContentSummaryView } from "../content/content-client";
import { verdictText } from "../content/content-state";

export type ContentTableProps = Readonly<{
  items: readonly ContentSummaryView[];
  /** The section's name, for the caption. */
  caption: string;
  /** Rendered only with the Content_Admin_Argument; absent otherwise (Req 17.5). */
  onOpen?: (contentId: string) => void;
  onSetStatus?: (contentId: string, status: ContentStatus) => void;
}>;

const STATUS_TEXT: Readonly<Record<ContentStatus, string>> = Object.freeze({
  draft: "Draft",
  active: "Active",
});

export function ContentTable({ items, caption, onOpen, onSetStatus }: ContentTableProps) {
  const writeEnabled = onOpen !== undefined && onSetStatus !== undefined;

  return (
    <table className="content-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Title</th>
          <th scope="col">Kind</th>
          <th scope="col">Categories</th>
          <th scope="col">Languages</th>
          <th scope="col">Age stages</th>
          <th scope="col">Steps</th>
          <th scope="col">Status</th>
          <th scope="col">Gate</th>
          {writeEnabled ? <th scope="col">Change</th> : null}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.content_id}>
            <th scope="row">{item.title}</th>
            <td>{item.kind}</td>
            <td>{item.categories.join(", ")}</td>
            <td>{item.languages.join(", ")}</td>
            <td>{item.age_stages.join(", ")}</td>
            <td>{item.step_count}</td>
            <td>{STATUS_TEXT[item.status]}</td>
            <td>{verdictText(item.verdict)}</td>
            {writeEnabled ? (
              <td className="content-row-actions">
                <button type="button" onClick={() => onOpen(item.content_id)}>
                  Edit {item.title}
                </button>{" "}
                <button
                  type="button"
                  onClick={() =>
                    onSetStatus(item.content_id, item.status === "active" ? "draft" : "active")
                  }
                >
                  {item.status === "active" ? `Withdraw ${item.title}` : `Activate ${item.title}`}
                </button>
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
