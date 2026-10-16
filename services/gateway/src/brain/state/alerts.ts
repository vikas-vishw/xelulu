// Parent_Alerts and Deferred_Questions (Req 7.2, 7.3, 8.2, 8.4, C10).
//
// safety.md §4 asks for two things the child cannot do for themselves: a deferred topic has to
// reach the parent as a question to answer together, and distress or a disclosure of harm has to
// reach the parent as an alert. This module is where both are raised.
//
// Phase 3 boundary (C10): they are held in this process and surfaced through the Gateway_Log and
// the Operator_Surface. They do NOT reach the parent app, which is still on mock data, and a
// restart loses them. Persisting them under RLS, and showing them to a parent, is the backend
// phase's work, and F2 (the DPDP s.9 review of parent-facing alerts) is still open.
//
// What is logged is a closed enum, an id, and — for a cry alert only — the two numbers the robot
// is allowed to send: confidence and duration (safety.md §1). No transcript, no name, no topic
// text, and never `active_child_id`.
import { type DeferralTopic, type ParentAlertKind } from "@xelulu/shared";

import { type Clock, isoAt } from "../../clock.js";
import type { IdSource } from "../../ids.js";
import type { GatewayLog } from "../../log/gateway-log.js";

/** Oldest alerts are dropped first once this many are held, so the process stays bounded. */
export const MAX_PARENT_ALERTS = 200;
export const MAX_DEFERRED_QUESTIONS = 200;

export type ParentAlert = Readonly<{
  alert_id: string;
  device_id: string;
  turn_id: string | null;
  alert: ParentAlertKind;
  at: string;
  /** cry only. */
  confidence: number | null;
  duration_s: number | null;
  /** deferred_question only. */
  topic: DeferralTopic | null;
}>;

export type DeferredQuestion = Readonly<{
  question_id: string;
  device_id: string;
  turn_id: string;
  topic: DeferralTopic;
  at: string;
}>;

export type CryAlertInput = Readonly<{
  deviceId: string;
  /** The event's own values, the only two that leave the robot (safety.md §1). */
  confidence: number;
  durationS: number;
}>;

export interface Alerts {
  /** Distress or a disclosure of harm on a turn (Req 8.2). */
  raiseTurnAlert(
    deviceId: string,
    turnId: string,
    alert: Extract<ParentAlertKind, "distress" | "harm_disclosure">,
  ): ParentAlert;
  /** A cry event. Carries confidence and duration and nothing else. */
  raiseCryAlert(input: CryAlertInput): ParentAlert;
  /** A deferred topic, which raises both a question and its own parent alert (Req 7.2, 7.3). */
  raiseDeferred(deviceId: string, turnId: string, topic: DeferralTopic): DeferredQuestion;
  parentAlerts(): readonly ParentAlert[];
  deferredQuestions(): readonly DeferredQuestion[];
}

export function createAlerts(
  deps: Readonly<{ clock: Clock; ids: IdSource; log: Pick<GatewayLog, "add"> }>,
): Alerts {
  const alerts: ParentAlert[] = [];
  const deferred: DeferredQuestion[] = [];

  /**
   * `IdSource.next` takes a closed prefix union owned by Phase 1.2, so these ids are prefixed
   * here rather than widening that module for two new kinds of local record.
   */
  const alertId = (): string => `alert_${deps.ids.next("")}`;
  const questionId = (): string => `defer_${deps.ids.next("")}`;

  function hold(alert: ParentAlert): ParentAlert {
    alerts.push(alert);
    while (alerts.length > MAX_PARENT_ALERTS) alerts.shift();
    deps.log.add({
      kind: "parent_alert",
      device_id: alert.device_id,
      turn_id: alert.turn_id,
      alert_id: alert.alert_id,
      alert: alert.alert,
      confidence: alert.confidence,
      duration_s: alert.duration_s,
      topic: alert.topic,
    });
    return alert;
  }

  return {
    raiseTurnAlert(deviceId, turnId, alert) {
      return hold({
        alert_id: alertId(),
        device_id: deviceId,
        turn_id: turnId,
        alert,
        at: isoAt(deps.clock.now()),
        confidence: null,
        duration_s: null,
        topic: null,
      });
    },

    raiseCryAlert(input) {
      return hold({
        alert_id: alertId(),
        device_id: input.deviceId,
        turn_id: null,
        alert: "cry",
        at: isoAt(deps.clock.now()),
        confidence: input.confidence,
        duration_s: input.durationS,
        topic: null,
      });
    },

    raiseDeferred(deviceId, turnId, topic) {
      const question: DeferredQuestion = {
        question_id: questionId(),
        device_id: deviceId,
        turn_id: turnId,
        topic,
        at: isoAt(deps.clock.now()),
      };
      deferred.push(question);
      while (deferred.length > MAX_DEFERRED_QUESTIONS) deferred.shift();
      // The parent hears about it as an alert too, so a deferral is not silent (Req 7.3).
      hold({
        alert_id: alertId(),
        device_id: deviceId,
        turn_id: turnId,
        alert: "deferred_question",
        at: question.at,
        confidence: null,
        duration_s: null,
        topic,
      });
      return question;
    },

    parentAlerts: () => [...alerts],
    deferredQuestions: () => [...deferred],
  };
}
