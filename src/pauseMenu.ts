import { BASE_PLAYER_STATS, MAX_DODGE_CHANCE, type Player, type PlayerStats } from "./player.js";
import { equipItem, getItemParams, getMaxLevel, ITEM_DEFINITIONS, setItemLevel, unequipItem, type ItemId, type ItemSystemState } from "./items.js";
import type { AnyItemDefinition, ParamScaling } from "./itemTypes.js";

// Master switch for dev tools. When false, the dev-mode hotkey does nothing.
export const DEV_TOOLS_ENABLED = true;
// KeyboardEvent.code that toggles dev mode (editing controls in the pause menu).
export const DEV_MODE_HOTKEY = "Backquote";

type StatKey = keyof PlayerStats;
type StatFormat = "flat" | "multiplier" | "chance" | "perSecond";

interface StatDisplay {
  label: string;
  format: StatFormat;
  // Step for the dev-mode number input.
  step: number;
}

// Every stat must be listed here, so adding one to PlayerStats fails to compile until it is.
const STAT_DISPLAY: Record<StatKey, StatDisplay> = {
  maxHealth: { label: "Max Health", format: "flat", step: 10 },
  healthRegenRate: { label: "Health Regen", format: "perSecond", step: 0.5 },
  armor: { label: "Armor", format: "flat", step: 1 },
  dodgeChance: { label: "Dodge Chance", format: "chance", step: 0.01 },
  moveSpeed: { label: "Move Speed", format: "flat", step: 10 },
  attackDamageMultiplier: { label: "Damage", format: "multiplier", step: 0.05 },
  attackRateMultiplier: { label: "Attack Speed", format: "multiplier", step: 0.05 },
  attackSizeMultiplier: { label: "Attack Size", format: "multiplier", step: 0.05 },
  critChance: { label: "Crit Chance", format: "chance", step: 0.01 },
  critDamageMultiplier: { label: "Crit Damage", format: "multiplier", step: 0.05 },
  pickupRange: { label: "Pickup Range", format: "flat", step: 5 },
  xpMultiplier: { label: "XP Gain", format: "multiplier", step: 0.05 },
};

const STAT_KEYS = Object.keys(STAT_DISPLAY) as StatKey[];
const ITEM_IDS = Object.keys(ITEM_DEFINITIONS) as ItemId[];

function round(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)));
}

function formatStat(key: StatKey, value: number): string {
  let text: string;
  switch (STAT_DISPLAY[key].format) {
    case "flat":
      text = round(value, 2);
      break;
    case "multiplier":
      text = `${round(value * 100, 1)}%`;
      break;
    case "chance":
      text = `${round(value * 100, 1)}%`;
      break;
    case "perSecond":
      text = `${round(value, 2)}/s`;
      break;
  }
  if (key === "dodgeChance" && value > MAX_DODGE_CHANCE) {
    text += ` (capped at ${round(MAX_DODGE_CHANCE * 100, 1)}%)`;
  }
  return text;
}

// Params with level bonuses and the player's stats applied, e.g. "interval 0.35 · damage 7".
function formatItemParams(item: AnyItemDefinition, level: number, player: Player): string {
  return Object.entries(getItemParams(item, level, player.stats))
    .map(([name, value]) => `${name} ${round(value, 2)}`)
    .join(" · ");
}

// Hover text listing which stats affect which params.
function describeScaling(item: AnyItemDefinition): string {
  const rules = Object.entries(item.scaling as Record<string, ParamScaling | undefined>)
    .filter((entry): entry is [string, ParamScaling] => entry[1] !== undefined)
    .map(([name, rule]) => `${name} ${rule.mode === "multiply" ? "×" : "÷"} ${STAT_DISPLAY[rule.stat].label}`);
  return rules.length > 0 ? `Scales: ${rules.join(", ")}` : "Not affected by stats";
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const node = el("button", "pause-button", label);
  node.addEventListener("click", onClick);
  return node;
}

function row(cells: (string | HTMLElement)[], header = false): HTMLTableRowElement {
  const tr = el("tr");
  for (const cell of cells) {
    const td = el(header ? "th" : "td");
    td.append(cell);
    tr.append(td);
  }
  return tr;
}

const PAUSE_TABS = [
  { id: "stats", label: "Stats" },
  { id: "items", label: "Items" },
] as const;

type PauseTab = (typeof PAUSE_TABS)[number]["id"];

export class PauseMenu {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly tabBar: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private tab: PauseTab = "stats";
  private devMode = false;
  private player: Player | null = null;
  private items: ItemSystemState | null = null;

  constructor(private readonly onResume: () => void) {
    this.root = el("div", "pause-menu");
    this.root.hidden = true;

    const panel = el("div", "pause-panel");
    this.title = el("h1", "pause-title");

    this.tabBar = el("div", "pause-tabs");
    for (const tab of PAUSE_TABS) {
      const tabButton = el("button", "pause-tab", tab.label);
      tabButton.dataset.tab = tab.id;
      tabButton.addEventListener("click", () => {
        this.tab = tab.id;
        this.render();
      });
      this.tabBar.append(tabButton);
    }

    this.body = el("div", "pause-body");

    const footer = el("div", "pause-footer");
    footer.append(button("Resume (ESC)", () => this.onResume()));

    panel.append(this.title, this.tabBar, this.body, footer);
    this.root.append(panel);
    document.body.append(this.root);
  }

  open(player: Player, items: ItemSystemState): void {
    this.player = player;
    this.items = items;
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.root.hidden = true;
    this.player = null;
    this.items = null;
    // Give focus back to the game so movement keys are not typed into a field.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  toggleDevMode(): void {
    if (!DEV_TOOLS_ENABLED) {
      return;
    }
    this.devMode = !this.devMode;
    if (!this.root.hidden) {
      this.render();
    }
  }

  private render(): void {
    this.title.textContent = this.devMode ? "Paused · DEV MODE" : "Paused";
    for (const tabButton of this.tabBar.querySelectorAll<HTMLButtonElement>(".pause-tab")) {
      tabButton.classList.toggle("active", tabButton.dataset.tab === this.tab);
    }
    this.body.replaceChildren();
    if (!this.player || !this.items) {
      return;
    }
    if (this.tab === "items") {
      this.renderItems(this.items, this.player);
    } else {
      this.renderStats(this.player);
    }
  }

  private renderStats(player: Player): void {
    const table = el("table", "pause-table");

    if (!this.devMode) {
      table.append(row(["Level", String(player.progression.level)]));
      table.append(row(["Health", `${Math.ceil(player.health)} / ${round(player.stats.maxHealth, 2)}`]));
      for (const key of STAT_KEYS) {
        table.append(row([STAT_DISPLAY[key].label, formatStat(key, player.stats[key])]));
      }
      this.body.append(table);
      return;
    }

    this.body.append(el("p", "pause-note", "Changes apply immediately."));
    table.append(row(["Stat", "Value", "Edit", "Base"], true));

    const healthInput = this.numberInput(player.health, 1, (value) => {
      player.health = Math.min(player.stats.maxHealth, Math.max(0, value));
    });
    table.append(row(["Current Health", "", healthInput, ""]));

    for (const key of STAT_KEYS) {
      const shown = el("span", "", formatStat(key, player.stats[key]));
      const input = this.numberInput(player.stats[key], STAT_DISPLAY[key].step, (value) => {
        player.stats[key] = value;
        shown.textContent = formatStat(key, value);
        if (key === "maxHealth" && player.health > value) {
          player.health = Math.max(0, value);
          healthInput.value = String(player.health);
        }
      });
      table.append(row([STAT_DISPLAY[key].label, shown, input, round(BASE_PLAYER_STATS[key], 2)]));
    }
    this.body.append(table);

    const actions = el("div", "pause-actions");
    actions.append(
      button("Reset stats to base", () => {
        Object.assign(player.stats, BASE_PLAYER_STATS);
        player.health = Math.min(player.health, player.stats.maxHealth);
        this.render();
      }),
      button("Full heal", () => {
        player.health = player.stats.maxHealth;
        this.render();
      }),
    );
    this.body.append(actions);
  }

  private renderItems(items: ItemSystemState, player: Player): void {
    const table = el("table", "pause-table");
    const header = ["#", "Item", "Level", "Stats (current values)"];
    table.append(row(this.devMode ? [...header, ""] : header, true));

    items.equipped.forEach((equipped, slotIndex) => {
      const params = el("span", "", formatItemParams(equipped.item, equipped.level, player));
      params.title = describeScaling(equipped.item);

      const maxLevel = getMaxLevel(equipped.item);
      const level = el("span", "pause-level");
      if (this.devMode && maxLevel > 1) {
        const changeLevel = (delta: number) => {
          if (setItemLevel(items, slotIndex, equipped.level + delta)) {
            this.render();
          }
        };
        level.append(button("−", () => changeLevel(-1)), ` ${equipped.level}/${maxLevel} `, button("+", () => changeLevel(1)));
      } else {
        level.textContent = `${equipped.level}/${maxLevel}`;
      }

      const cells: (string | HTMLElement)[] = [String(slotIndex + 1), equipped.item.name, level, params];
      if (this.devMode) {
        cells.push(
          button("Remove", () => {
            unequipItem(items, slotIndex);
            this.render();
          }),
        );
      }
      table.append(row(cells));
    });

    if (items.equipped.length === 0) {
      this.body.append(el("p", "pause-note", "No items equipped."));
    } else {
      this.body.append(table);
    }

    if (!this.devMode) {
      return;
    }

    const select = el("select", "pause-input pause-select");
    for (const itemId of ITEM_IDS) {
      const option = el("option", "", ITEM_DEFINITIONS[itemId].name);
      option.value = itemId;
      select.append(option);
    }
    const actions = el("div", "pause-actions");
    actions.append(
      select,
      button("Add item", () => {
        equipItem(items, select.value as ItemId);
        this.render();
      }),
    );
    this.body.append(actions);
  }

  private numberInput(value: number, step: number, onChange: (value: number) => void): HTMLInputElement {
    const input = el("input", "pause-input");
    input.type = "number";
    input.step = String(step);
    input.value = String(value);
    input.addEventListener("input", () => {
      if (Number.isFinite(input.valueAsNumber)) {
        onChange(input.valueAsNumber);
      }
    });
    return input;
  }
}
