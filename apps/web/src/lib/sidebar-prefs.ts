// Sidebar layout kept per browser, like the assistant's (ADR 0031).

export const sidebarCollapsed = {
  get: () => {
    try {
      return localStorage.getItem("sidebar.collapsed") === "true";
    } catch {
      return false;
    }
  },
  set: (collapsed: boolean) => {
    try {
      localStorage.setItem("sidebar.collapsed", String(collapsed));
    } catch {}
  },
};
