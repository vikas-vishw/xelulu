// Simulator panel script (Req 20.2, 20.3, 20.5). Same-origin relative fetches to /api/* only,
// with a JSON content type for every state change. Every list of zones, gestures, kinds, actions,
// reasons and test utterances comes from the `choices` of /api/state — the wire lists copied from
// the contract, the utterance names the simulator's own — so nothing here restates a list.
// Results go to the polite live region as text
// (never as markup). Nothing is stored in the browser.

const API = "/api/";

const result = document.getElementById("result");
const stateView = document.getElementById("state-view");
let choicesFilled = false;

/** Shows one result as text in the live region. */
function show(value) {
  result.textContent = JSON.stringify(value);
}

/** One call to the Control_Surface; a network failure becomes a local error result. */
async function call(method, operation, body) {
  const init =
    method === "POST"
      ? {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { method };
  try {
    const response = await fetch(API + operation, init);
    return await response.json();
  } catch {
    return { ok: false, error: { code: "unreachable" } };
  }
}

/** Appends one option per value; the visible text is the value itself. */
function fillSelect(select, values) {
  for (const value of values) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  }
}

/** One submit button per touch zone, in the order the simulator gives. */
function fillZones(zones) {
  const holder = document.getElementById("touch-zones");
  for (const zone of zones) {
    const button = document.createElement("button");
    button.type = "submit";
    button.name = "zone";
    button.value = zone;
    button.textContent = "Touch " + zone;
    holder.append(button);
  }
}

function fillChoices(choices) {
  fillSelect(document.getElementById("touch-gesture"), choices.touch_gestures);
  fillZones(choices.touch_zones);
  fillSelect(document.getElementById("event-kind"), choices.event_kinds);
  fillSelect(document.getElementById("ack-scope"), choices.cmd_actions);
  fillSelect(document.getElementById("ack-reason"), choices.ack_reasons);
  fillSelect(document.getElementById("utterance"), choices.utterances);
  choicesFilled = true;
}

/** Shows the state without its `choices`, and syncs the battery and replay controls. */
function renderState(state) {
  const view = { ...state };
  delete view.choices;
  stateView.textContent = JSON.stringify(view, null, 2);
  document.getElementById("duplicate-enabled").checked = state.duplicate_replay === true;
  document.getElementById("battery-pct").value = String(state.battery_pct);
  document.getElementById("battery-charging").checked = state.charging === true;
}

async function refresh() {
  const state = await call("GET", "state");
  if (state.ok !== true) {
    show(state);
    return null;
  }
  if (!choicesFilled) fillChoices(state.choices);
  renderState(state);
  return state;
}

/** Runs one operation, shows its result, then refreshes the state view. */
async function run(operation, body) {
  const answer = await call("POST", operation, body);
  show(answer);
  await refresh();
}

/** Wires a form's submit to `handler(submitter)`; the browser never submits the form itself. */
function onSubmit(id, handler) {
  document.getElementById(id).addEventListener("submit", (event) => {
    event.preventDefault();
    void handler(event.submitter);
  });
}

onSubmit("events-form", (submitter) => {
  if (submitter !== null && submitter.name === "zone") {
    const gesture = document.getElementById("touch-gesture").value;
    return run("events", { event: "touch", data: { zone: submitter.value, gesture } });
  }
  const kind = document.getElementById("event-kind").value;
  const text = document.getElementById("event-data").value.trim();
  if (text === "") return run("events", { event: kind });
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    show({ ok: false, error: { code: "invalid_json" } });
    return Promise.resolve();
  }
  return run("events", { event: kind, data });
});

// An empty utterance keeps the Phase 1.2 synthetic upload; a name asks for that utterance.
onSubmit("audio-form", () => {
  const utterance = document.getElementById("utterance").value;
  return run("audio-turn", utterance === "" ? {} : { utterance });
});

onSubmit("connection-form", (submitter) =>
  run("connection", { online: submitter !== null && submitter.value === "true" }),
);

onSubmit("duplicate-form", () =>
  run("duplicate-replay", { enabled: document.getElementById("duplicate-enabled").checked }),
);

onSubmit("ack-form", (submitter) => {
  const scope = document.getElementById("ack-scope").value;
  if (submitter !== null && submitter.value === "clear") {
    return run("ack-policy/clear", { scope });
  }
  const mode = document.getElementById("ack-mode").value;
  const reason = document.getElementById("ack-reason").value;
  const takesReason = mode === "reject" || mode === "fail";
  return run("ack-policy", { scope, override: takesReason ? { mode, reason } : { mode } });
});

onSubmit("battery-form", () =>
  run("battery", {
    battery_pct: document.getElementById("battery-pct").valueAsNumber,
    charging: document.getElementById("battery-charging").checked,
  }),
);

onSubmit("state-form", async () => {
  const state = await refresh();
  if (state !== null) show({ ok: true });
});

void refresh().then((state) => {
  if (state !== null) result.textContent = "Ready.";
});
