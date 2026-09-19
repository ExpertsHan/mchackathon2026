// Lightweight named sign-off for the reviewer console: the name is remembered in this
// browser and recorded as the audit actor. It is not authentication.
const KEY = "ai-subsidy-reviewer-name";

export function readReviewerName(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveReviewerName(name: string) {
  try {
    window.localStorage.setItem(KEY, name);
  } catch {
    // Private mode or blocked storage: the name is simply asked for again.
  }
}
