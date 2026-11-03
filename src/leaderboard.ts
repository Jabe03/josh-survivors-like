// Client for the shared leaderboard (leaderboard.mjs), plus the name form shown on death.

export interface LeaderboardEntry {
  name: string;
  // Seconds survived.
  time: number;
  level: number;
  kills: number;
}

// What the death screen shows for the leaderboard.
export type LeaderboardView =
  | { status: "entering" }
  | { status: "loading" }
  | { status: "ready"; entries: LeaderboardEntry[]; rank: number | null }
  | { status: "offline" };

// Relative, so it works wherever the game is hosted (e.g. /final/api/leaderboard).
const API_URL = "api/leaderboard";
const NAME_STORAGE_KEY = "circle-survivors-name";

// The top entries, and the submitted run's place (null if it didn't make the board or none was sent).
export type LeaderboardResult = { entries: LeaderboardEntry[]; rank: number | null };

async function request(init?: RequestInit): Promise<LeaderboardResult | null> {
  try {
    const res = await fetch(API_URL, init);
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as LeaderboardResult;
    return Array.isArray(data.entries) ? data : null;
  } catch {
    return null;
  }
}

// Top entries, or null when the server can't be reached.
export function fetchLeaderboard(): Promise<LeaderboardResult | null> {
  return request();
}

// Adds the run and returns the top entries and its rank, or null when it can't be saved.
export function submitScore(entry: LeaderboardEntry): Promise<LeaderboardResult | null> {
  return request({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(entry) });
}

// A small HTML form over the death screen asking for a name. Enter submits, Escape skips.
// The last name used is remembered in this browser.
export class NameForm {
  private readonly root = document.createElement("form");
  private readonly input = document.createElement("input");
  private onDone: ((name: string | null) => void) | null = null;

  constructor() {
    this.root.className = "name-form";
    this.root.hidden = true;
    this.input.className = "pause-input name-input";
    this.input.maxLength = 16;
    this.input.placeholder = "Your name";
    const submit = document.createElement("button");
    submit.className = "pause-button";
    submit.textContent = "Submit score";
    const skip = document.createElement("button");
    skip.className = "pause-button";
    skip.type = "button";
    skip.textContent = "Skip";
    this.root.append(this.input, submit, skip);
    document.body.append(this.root);

    this.root.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = this.input.value.trim();
      try {
        localStorage.setItem(NAME_STORAGE_KEY, name);
      } catch {
        // Storage can be blocked; the name just won't be remembered.
      }
      this.finish(name);
    });
    skip.addEventListener("click", () => this.finish(null));
    this.input.addEventListener("keydown", (e) => {
      if (e.code === "Escape") {
        this.finish(null);
      }
    });
    // Clicks on the form shouldn't reach the game's click-to-continue.
    this.root.addEventListener("pointerdown", (e) => e.stopPropagation());
  }

  // Shows the form; onDone gets the name, or null if skipped.
  open(onDone: (name: string | null) => void): void {
    this.onDone = onDone;
    try {
      this.input.value = localStorage.getItem(NAME_STORAGE_KEY) ?? "";
    } catch {
      this.input.value = "";
    }
    this.root.hidden = false;
    this.input.focus();
    this.input.select();
  }

  close(): void {
    this.root.hidden = true;
    this.onDone = null;
    this.input.blur();
  }

  private finish(name: string | null): void {
    const done = this.onDone;
    this.close();
    done?.(name);
  }
}
