// Assistant memory (ADR 0032): what the in-app assistant and MCP clients are told about the memories they can reuse.
import { type Db, projectMemory, userMemory } from "@crm/db";
import { and, asc, eq, isNull } from "drizzle-orm";
import { pid } from "../http/serialize.js";

/** Memories beyond this many characters are listed by title only, so a large memory cannot crowd out the prompt. */
const PROMPT_BUDGET = 30_000;

export const MEMORY_INSTRUCTIONS =
  "Memory holds facts worth reusing across conversations. User memory belongs to the user and applies in all of " +
  "their projects (background, skills, preferences, writing style, compensation expectations); only they can see " +
  "it. Project memory is shared with every member of this project (goals and constraints of this search, decisions, " +
  "context that does not belong in a CRM record). When the user shares something lasting or asks you to remember " +
  "something, save it: update the memory on the same topic rather than adding a near-duplicate, keep each memory " +
  "short and self-contained, and do not copy what CRM records already hold or store secrets. Delete memories that " +
  "turn out to be wrong. The user can see and edit every memory in the app.";

type Entry = { id: string; version: number; title: string; content: string };

export async function loadMemories(db: Db, userId: string, projectId: string) {
  const [user, project] = await Promise.all([
    db.select().from(userMemory).where(eq(userMemory.userId, userId)).orderBy(asc(userMemory.id)),
    db
      .select()
      .from(projectMemory)
      .where(and(eq(projectMemory.projectId, projectId), isNull(projectMemory.deletedAt)))
      .orderBy(asc(projectMemory.id)),
  ]);
  return {
    user: user.map((m) => ({ ...m, id: pid("userMemory", m.id) })),
    project: project.map((m) => ({ ...m, id: pid("projectMemory", m.id) })),
  };
}

/** The memory guidance followed by every memory, with the ID and version the update tools need. */
export function renderMemories(memories: { user: Entry[]; project: Entry[] }) {
  let budget = PROMPT_BUDGET;
  const section = (heading: string, entries: Entry[]) => {
    if (!entries.length) return `${heading}: empty.`;
    const lines = entries.map((m) => {
      const head = `### ${m.title} (${m.id}, version ${m.version})`;
      if (m.content.length > budget) return `${head}\n(Too long to include here; read it with the list tool.)`;
      budget -= m.content.length;
      return `${head}\n${m.content}`;
    });
    return `${heading}:\n\n${lines.join("\n\n")}`;
  };
  return [
    MEMORY_INSTRUCTIONS,
    section("## User memory", memories.user),
    section("## Project memory", memories.project),
  ].join("\n\n");
}
