export const ORGANIZATION_KINDS = ["company", "agency"] as const;
export type OrganizationKind = (typeof ORGANIZATION_KINDS)[number];

export const POSITION_OUTCOMES = ["open", "accepted", "rejected", "withdrawn", "ghosted"] as const;
export type PositionOutcome = (typeof POSITION_OUTCOMES)[number];

export const SALARY_PERIODS = ["year", "month", "hour"] as const;

export const ACTION_TYPES = [
  "email",
  "meeting",
  "interview",
  "application",
  "take_home",
  "offer",
  "reference_check",
  "rejection",
  "task",
  "note",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_STATUSES = ["planned", "done", "cancelled", "no_show", "rescheduled"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

export const EDGE_KINDS = ["follow_up", "subtask", "blocks", "rescheduled", "related"] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export const PARTICIPANT_ROLES = ["from", "to", "cc", "attendee", "interviewer", "referrer", "referee"] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const DOCUMENT_KINDS = ["resume", "cover_letter", "take_home", "offer", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const COMPILE_STATUSES = ["queued", "running", "ready", "failed"] as const;
export type CompileStatus = (typeof COMPILE_STATUSES)[number];

export const COMMENT_TARGETS = ["organization", "position", "contact", "action", "document"] as const;
export type CommentTarget = (typeof COMMENT_TARGETS)[number];

export const AUDIT_VIA = ["web", "api_key", "mcp", "chat"] as const;
export type AuditVia = (typeof AUDIT_VIA)[number];

// In-app assistant (ADR 0031)
export const AI_PROVIDERS = ["anthropic", "openai", "google"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Which CRM tool calls run without asking: none, reads, reads and writes, or everything. */
export const CHAT_APPROVAL_MODES = ["manual", "read", "write", "all"] as const;
export type ChatApprovalMode = (typeof CHAT_APPROVAL_MODES)[number];
