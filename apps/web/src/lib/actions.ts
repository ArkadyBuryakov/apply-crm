// UI metadata for action types (docs/domain/action-types.md): labels, icons and payload form fields.
import { type ActionStatus, type ActionType, ALLOWED_STATUSES } from "@crm/shared";
import {
  Ban,
  BookOpen,
  CheckSquare,
  FileCheck2,
  FileCode2,
  Handshake,
  type LucideIcon,
  Mail,
  MessagesSquare,
  NotebookPen,
  Send,
} from "lucide-react";

export const ACTION_META: Record<ActionType, { label: string; icon: LucideIcon }> = {
  email: { label: "Email", icon: Mail },
  meeting: { label: "Meeting / call", icon: MessagesSquare },
  interview: { label: "Interview", icon: Handshake },
  application: { label: "Application", icon: Send },
  take_home: { label: "Take-home", icon: FileCode2 },
  offer: { label: "Offer", icon: FileCheck2 },
  reference_check: { label: "Reference check", icon: BookOpen },
  rejection: { label: "Rejection", icon: Ban },
  task: { label: "Task", icon: CheckSquare },
  note: { label: "Note", icon: NotebookPen },
};

export const STATUS_TONE: Record<ActionStatus, "neutral" | "primary" | "success" | "warning" | "danger"> = {
  planned: "primary",
  done: "success",
  cancelled: "neutral",
  no_show: "danger",
  rescheduled: "warning",
};

export type FieldSpec =
  | { key: string; label: string; kind: "text" | "textarea" | "url" | "date"; required?: boolean; hint?: string }
  | { key: string; label: string; kind: "number"; required?: boolean; step?: number; min?: number; max?: number }
  | { key: string; label: string; kind: "select"; options: readonly string[]; required?: boolean; optional?: boolean }
  | { key: string; label: string; kind: "money"; required?: boolean; withPeriod?: boolean }
  | { key: string; label: string; kind: "checklist" };

const direction = ["inbound", "outbound"] as const;

export const PAYLOAD_FIELDS: Record<ActionType, FieldSpec[]> = {
  email: [
    { key: "direction", label: "Direction", kind: "select", options: direction, required: true },
    { key: "subject", label: "Subject", kind: "text" },
    { key: "body", label: "Body or summary", kind: "textarea" },
  ],
  meeting: [
    { key: "format", label: "Format", kind: "select", options: ["phone", "video", "in_person"], required: true },
    { key: "direction", label: "Who initiated", kind: "select", options: direction, optional: true },
    { key: "location", label: "Location", kind: "text" },
    { key: "link", label: "Link", kind: "url" },
    { key: "durationMin", label: "Duration (min)", kind: "number", min: 0 },
    { key: "summary", label: "What was discussed", kind: "textarea" },
  ],
  interview: [
    {
      key: "kind",
      label: "Kind",
      kind: "select",
      options: [
        "screening",
        "technical",
        "live_coding",
        "system_design",
        "behavioral",
        "hiring_manager",
        "panel",
        "culture",
        "final",
        "other",
      ],
      required: true,
    },
    { key: "format", label: "Format", kind: "select", options: ["phone", "video", "onsite"], required: true },
    { key: "round", label: "Round", kind: "number", min: 1 },
    { key: "location", label: "Location", kind: "text" },
    { key: "link", label: "Link", kind: "url" },
    { key: "durationMin", label: "Duration (min)", kind: "number", min: 0 },
    { key: "prep", label: "Preparation", kind: "textarea" },
    { key: "debrief", label: "Debrief", kind: "textarea" },
    { key: "selfRating", label: "How it went (1–5)", kind: "number", min: 1, max: 5 },
  ],
  application: [
    {
      key: "method",
      label: "Method",
      kind: "select",
      options: ["portal", "easy_apply", "email", "referral", "agency", "other"],
      required: true,
    },
    { key: "applicationUrl", label: "Application URL", kind: "url" },
    { key: "confirmationRef", label: "Confirmation / ATS ID", kind: "text" },
  ],
  take_home: [
    { key: "brief", label: "Assignment", kind: "textarea" },
    { key: "briefUrl", label: "Assignment URL", kind: "url" },
    { key: "estimatedHours", label: "Estimated hours", kind: "number", min: 0, step: 0.5 },
    { key: "spentHours", label: "Hours spent", kind: "number", min: 0, step: 0.5 },
    { key: "submissionUrl", label: "Submission URL", kind: "url" },
  ],
  offer: [
    { key: "base", label: "Base pay", kind: "money", required: true, withPeriod: true },
    { key: "signOn", label: "Sign-on bonus", kind: "money" },
    { key: "equity", label: "Equity", kind: "text" },
    { key: "benefits", label: "Benefits", kind: "textarea" },
    { key: "startDate", label: "Start date", kind: "date" },
    {
      key: "decision",
      label: "Decision",
      kind: "select",
      options: ["pending", "negotiating", "accepted", "declined"],
      required: true,
    },
  ],
  reference_check: [
    { key: "relationship", label: "Relationship", kind: "text" },
    {
      key: "outcome",
      label: "Outcome",
      kind: "select",
      options: ["positive", "neutral", "negative", "unknown"],
      optional: true,
    },
  ],
  rejection: [
    { key: "by", label: "Rejected by", kind: "select", options: ["company", "agency"], required: true },
    { key: "reason", label: "Reason given", kind: "text" },
    { key: "feedback", label: "Feedback", kind: "textarea" },
  ],
  task: [
    { key: "priority", label: "Priority", kind: "select", options: ["low", "normal", "high"], required: true },
    { key: "checklist", label: "Checklist", kind: "checklist" },
  ],
  note: [],
};

export function defaultPayload(type: ActionType): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of PAYLOAD_FIELDS[type]) {
    if (f.kind === "select" && f.required) payload[f.key] = f.options[type === "task" ? 1 : 0];
    if (f.kind === "money" && f.required) payload[f.key] = { currency: "EUR", period: "year" };
  }
  return payload;
}

export function statusesFor(type: ActionType) {
  return ALLOWED_STATUSES[type];
}

/** The one-line detail shown under an action's title. */
export function actionSummary(type: ActionType, payload: Record<string, unknown>): string {
  const p = payload as Record<string, string | number | undefined>;
  switch (type) {
    case "email":
      return [p.direction, p.subject].filter(Boolean).join(" · ");
    case "meeting":
      return [p.format, p.durationMin ? `${p.durationMin} min` : null].filter(Boolean).join(" · ");
    case "interview":
      return [p.kind, p.round ? `round ${p.round}` : null, p.format].filter(Boolean).join(" · ");
    case "application":
      return String(p.method ?? "");
    case "offer": {
      const base = payload.base as { amount?: number; currency?: string; period?: string } | undefined;
      return [base ? `${base.amount} ${base.currency}/${base.period}` : null, p.decision].filter(Boolean).join(" · ");
    }
    case "rejection":
      return [p.by ? `by ${p.by}` : null, p.stageKey ? `at ${p.stageKey}` : null, p.reason].filter(Boolean).join(" · ");
    case "task":
      return p.priority === "normal" ? "" : `${p.priority} priority`;
    default:
      return "";
  }
}
