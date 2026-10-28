const KEY = "lastProjectId";

/** The project opened most recently in this browser, so `/` can land straight in it. */
export function getLastProject(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setLastProject(projectId: string) {
  try {
    localStorage.setItem(KEY, projectId);
  } catch {}
}

export function clearLastProject(projectId?: string) {
  try {
    if (!projectId || localStorage.getItem(KEY) === projectId) localStorage.removeItem(KEY);
  } catch {}
}
