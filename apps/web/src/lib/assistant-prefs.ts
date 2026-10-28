// Assistant state kept in the browser (ADR 0031). The open chat is per tab (sessionStorage), so a reload keeps it and
// a new tab starts fresh; layout and defaults for new chats are per browser (localStorage).

export type ApprovalMode = "manual" | "read" | "write" | "all";

export type AssistantDefaults = { model: string | null; approvalMode: ApprovalMode; webSearch: boolean };

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}

function write(storage: () => Storage, key: string, value: string | null) {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {}
}

const session = () => sessionStorage;
const local = () => localStorage;

export const activeChat = {
  get: (projectId: string) => read(session, `assistant.chat.${projectId}`),
  set: (projectId: string, chatId: string | null) => write(session, `assistant.chat.${projectId}`, chatId),
};

export const panelOpen = {
  get: () => read(local, "assistant.open") === "true",
  set: (open: boolean) => write(local, "assistant.open", String(open)),
};

export const panelWidth = {
  get: () => Number(read(local, "assistant.width")) || 420,
  set: (width: number) => write(local, "assistant.width", String(Math.round(width))),
};

export function getDefaults(): AssistantDefaults {
  const mode = read(local, "assistant.approvalMode");
  return {
    model: read(local, "assistant.model"),
    approvalMode: mode === "manual" || mode === "write" || mode === "all" ? mode : "read",
    webSearch: read(local, "assistant.webSearch") === "true",
  };
}

/** Whatever the user picks last becomes the default for their next new chat. */
export function saveDefaults(defaults: Partial<AssistantDefaults>) {
  if (defaults.model !== undefined) write(local, "assistant.model", defaults.model);
  if (defaults.approvalMode !== undefined) write(local, "assistant.approvalMode", defaults.approvalMode);
  if (defaults.webSearch !== undefined) write(local, "assistant.webSearch", String(defaults.webSearch));
}
