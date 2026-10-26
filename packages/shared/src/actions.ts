// Action payloads per type (ADR 0004, ADR 0029, docs/domain/action-types.md).
import { z } from "zod";
import type { ActionStatus, ActionType } from "./enums.js";

const markdown = z.string().max(100_000);
const shortText = z.string().max(500);
const url = z.url().max(2000);
const minutes = z
  .int()
  .min(0)
  .max(24 * 60);

export const MoneySchema = z.object({
  amount: z.number().nonnegative(),
  currency: z.string().length(3).describe("ISO 4217 code, e.g. EUR"),
});

const direction = z.enum(["inbound", "outbound"]);

export const ACTION_PAYLOAD_SCHEMAS = {
  email: z.object({
    direction,
    subject: shortText.optional(),
    body: markdown.optional().describe("Pasted body or a summary"),
    messageId: shortText.optional().describe("RFC 5322 Message-ID, reserved for mail sync"),
  }),
  meeting: z.object({
    direction: direction.optional().describe("Who initiated it"),
    format: z.enum(["phone", "video", "in_person"]),
    location: shortText.optional(),
    link: url.optional(),
    durationMin: minutes.optional(),
    summary: markdown.optional().describe("What was discussed"),
  }),
  interview: z.object({
    round: z.int().min(1).max(50).optional(),
    kind: z.enum([
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
    ]),
    format: z.enum(["phone", "video", "onsite"]),
    location: shortText.optional(),
    link: url.optional(),
    durationMin: minutes.optional(),
    prep: markdown.optional().describe("Preparation notes, questions to ask"),
    debrief: markdown.optional().describe("What was asked and how it went"),
    selfRating: z.int().min(1).max(5).optional(),
  }),
  application: z.object({
    method: z.enum(["portal", "easy_apply", "email", "referral", "agency", "other"]),
    applicationUrl: url.optional(),
    confirmationRef: shortText.optional().describe("ATS application ID"),
  }),
  take_home: z.object({
    brief: markdown.optional(),
    briefUrl: url.optional(),
    estimatedHours: z.number().min(0).max(1000).optional(),
    spentHours: z.number().min(0).max(1000).optional(),
    submissionUrl: url.optional(),
  }),
  offer: z.object({
    base: MoneySchema.extend({ period: z.enum(["year", "month", "hour"]) }),
    bonus: z.union([MoneySchema, shortText]).optional(),
    signOn: MoneySchema.optional(),
    equity: shortText.optional().describe('Free text, e.g. "0.1% over 4y, 1y cliff"'),
    benefits: markdown.optional(),
    startDate: z.iso.date().optional(),
    decision: z.enum(["pending", "negotiating", "accepted", "declined"]),
  }),
  reference_check: z.object({
    relationship: shortText.optional().describe('e.g. "former manager at X"'),
    outcome: z.enum(["positive", "neutral", "negative", "unknown"]).optional(),
  }),
  rejection: z.object({
    by: z.enum(["company", "agency"]),
    stageKey: shortText.optional().describe("Stage the position was at; filled from the position when omitted"),
    reason: shortText.optional(),
    feedback: markdown.optional(),
  }),
  task: z.object({
    priority: z.enum(["low", "normal", "high"]).default("normal"),
    checklist: z
      .array(z.object({ text: shortText, done: z.boolean() }))
      .max(100)
      .optional(),
  }),
  note: z.object({}),
} as const satisfies Record<ActionType, z.ZodType>;

export type ActionPayloads = { [K in ActionType]: z.infer<(typeof ACTION_PAYLOAD_SCHEMAS)[K]> };

/** Status × type matrix. */
export const ALLOWED_STATUSES: Record<ActionType, readonly ActionStatus[]> = {
  email: ["planned", "done", "cancelled"],
  meeting: ["planned", "done", "cancelled", "no_show", "rescheduled"],
  interview: ["planned", "done", "cancelled", "no_show", "rescheduled"],
  application: ["planned", "done", "cancelled"],
  take_home: ["planned", "done", "cancelled", "rescheduled"],
  offer: ["done"],
  reference_check: ["planned", "done", "cancelled"],
  rejection: ["done"],
  task: ["planned", "done", "cancelled", "rescheduled"],
  note: ["done"],
};

export function defaultStatusFor(type: ActionType): ActionStatus {
  return ALLOWED_STATUSES[type].includes("planned") ? "planned" : "done";
}

/** Types whose status can become `rescheduled`, which is what the reschedule operation needs. */
export function canReschedule(type: ActionType): boolean {
  return ALLOWED_STATUSES[type].includes("rescheduled");
}
