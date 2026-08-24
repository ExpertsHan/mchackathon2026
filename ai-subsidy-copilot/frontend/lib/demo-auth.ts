const DEMO_TOKEN_KEY = "ai-subsidy-demo-token";
let inMemoryDemoToken: string | null = null;
const ALLOWED_POST_LOGIN_PATHS = new Set(["/apply", "/track", "/safety"]);

export function validatedPostLoginPath(value: string | null | undefined): string {
  return value && ALLOWED_POST_LOGIN_PATHS.has(value) ? value : "/apply";
}

export function readDemoToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    inMemoryDemoToken = window.localStorage.getItem(DEMO_TOKEN_KEY) ?? inMemoryDemoToken;
  } catch {
    // In-memory fallback keeps the current demo tab usable if storage is unavailable.
  }
  return inMemoryDemoToken;
}

export function writeDemoToken(token: string) {
  if (typeof window === "undefined") return;
  inMemoryDemoToken = token;
  try {
    window.localStorage.setItem(DEMO_TOKEN_KEY, token);
  } catch {
    // The in-memory token still supports requests for the current tab.
  }
}

export function clearDemoToken() {
  if (typeof window === "undefined") return;
  inMemoryDemoToken = null;
  try {
    window.localStorage.removeItem(DEMO_TOKEN_KEY);
  } catch {
    // Nothing else to clear when browser storage is unavailable.
  }
}
