import { BASE_PLAYER_STATS, type Player } from "./player.js";
import { getItemParams, getMaxLevel, ITEM_DEFINITIONS, type EquippedItem, type ItemId } from "./items.js";
import type { AnyItemDefinition, ParamScaling } from "./itemTypes.js";
import { formatStat, formatStatDelta, paramLabel, round, STAT_DISPLAY, STAT_KEYS } from "./format.js";
import { MAX_STAT_LEVEL, MAX_STAT_LINES, setStatLineLevel, UPGRADE_DEFINITIONS, type UpgradeDefinition } from "./upgrades.js";

// Master switch for dev tools. When false, the dev-mode hotkey does nothing.
export const DEV_TOOLS_ENABLED = true;
// KeyboardEvent.code that toggles dev mode (editing controls in the pause menu).
export const DEV_MODE_HOTKEY = "Backquote";

const ITEM_IDS = Object.keys(ITEM_DEFINITIONS) as ItemId[];

// Which stat scales each param, e.g. " (× Damage)", for the item details list.
function scalingNote(item: AnyItemDefinition, param: string): string {
  const rule = (item.scaling as Record<string, ParamScaling | undefined>)[param];
  return rule ? ` (${rule.mode === "multiply" ? "×" : "÷"} ${STAT_DISPLAY[rule.stat].label})` : "";
}

// One line per param with level bonuses and the player's stats applied, e.g.
// "Explosion radius 86 (× Attack Size)".
function itemParamList(item: AnyItemDefinition, level: number, player: Player): HTMLUListElement {
  const list = el("ul", "pause-params");
  for (const [name, value] of Object.entries(getItemParams(item, level, player.stats))) {
    list.append(el("li", "", `${paramLabel(name)} ${round(value, 2)}${scalingNote(item, name)}`));
  }
  return list;
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

const GIVE_UP_LABEL = "Give up";
const GIVE_UP_CONFIRM_LABEL = "Click again to end the run";

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
  { id: "statLines", label: "Stat Lines" },
] as const;

// "■■□□□" for level 2 of 5.
function levelPips(level: number, max: number): string {
  return "■".repeat(Math.min(level, max)) + "□".repeat(Math.max(0, max - level));
}

// What a stat line adds at `level`, one line per stat, e.g. "Damage +30%".
function statLineTotals(upgrade: UpgradeDefinition, level: number): HTMLUListElement {
  const list = el("ul", "pause-params");
  for (const { stat, amount } of upgrade.modifiers) {
    list.append(el("li", "", `${STAT_DISPLAY[stat].label} ${formatStatDelta(stat, amount * level)}`));
  }
  return list;
}

type PauseTab = (typeof PAUSE_TABS)[number]["id"];

export class PauseMenu {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly tabBar: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private tab: PauseTab = "stats";
  private devMode = false;
  private player: Player | null = null;

  // Asks for a second click before giving up, so one stray click can't end a run.
  private readonly giveUpButton: HTMLButtonElement;

  constructor(
    private readonly onResume: () => void,
    private readonly onGiveUp: () => void,
  ) {
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
    this.giveUpButton = button(GIVE_UP_LABEL, () => {
      if (this.giveUpButton.textContent === GIVE_UP_LABEL) {
        this.giveUpButton.textContent = GIVE_UP_CONFIRM_LABEL;
      } else {
        this.onGiveUp();
      }
    });
    footer.append(button("Resume (ESC)", () => this.onResume()), this.giveUpButton);

    panel.append(this.title, this.tabBar, this.body, footer);
    this.root.append(panel);
    document.body.append(this.root);
  }

  open(player: Player): void {
    this.player = player;
    this.root.hidden = false;
    this.giveUpButton.textContent = GIVE_UP_LABEL;
    this.render();
  }

  close(): void {
    this.root.hidden = true;
    this.player = null;
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
    if (!this.player) {
      return;
    }
    if (this.tab === "items") {
      this.renderItems(this.player);
    } else if (this.tab === "statLines") {
      this.renderStatLines(this.player);
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
        player.statLines.clear();
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

  // Held stat lines with what they add so far, then the lines not taken. Dev mode adds level
  // controls, removal, and adding any line regardless of the slot cap.
  private renderStatLines(player: Player): void {
    const slotsLeft = MAX_STAT_LINES - player.statLines.size;
    this.body.append(
      el(
        "p",
        "pause-note",
        `Slots used ${player.statLines.size} / ${MAX_STAT_LINES}. Stat lines are picked at each Stat Up (the ticks on the XP bar) and level up to ${MAX_STAT_LEVEL}.`,
      ),
    );

    if (player.statLines.size === 0) {
      this.body.append(el("p", "pause-note", "No stat lines yet."));
    } else {
      const held = el("table", "pause-table");
      const header = ["#", "Stat line", "Level", "Adds in total"];
      held.append(row(this.devMode ? [...header, ""] : header, true));
      [...player.statLines].forEach(([id, level], index) => {
        const upgrade = UPGRADE_DEFINITIONS.find((u) => u.id === id);
        if (!upgrade) {
          return;
        }
        const nameCell = el("div");
        nameCell.append(el("div", "pause-item-name", upgrade.name), el("div", "pause-item-desc", `Per level: ${upgrade.description}`));

        const levelCell = el("span", "pause-level");
        if (this.devMode) {
          const change = (delta: number) => {
            setStatLineLevel(player, id, level + delta);
            this.render();
          };
          levelCell.append(button("−", () => change(-1)), ` ${level}/${MAX_STAT_LEVEL} `, button("+", () => change(1)));
        } else {
          levelCell.textContent = `${levelPips(level, MAX_STAT_LEVEL)} ${level}/${MAX_STAT_LEVEL}`;
        }

        const cells: (string | HTMLElement)[] = [String(index + 1), nameCell, levelCell, statLineTotals(upgrade, level)];
        if (this.devMode) {
          cells.push(
            button("Remove", () => {
              setStatLineLevel(player, id, 0);
              this.render();
            }),
          );
        }
        held.append(row(cells));
      });
      this.body.append(held);
    }

    const notTaken = UPGRADE_DEFINITIONS.filter((u) => !player.statLines.has(u.id));
    if (notTaken.length === 0) {
      return;
    }
    this.body.append(el("h2", "pause-subheading", slotsLeft > 0 ? "Not taken yet" : "Not taken (slots full)"));
    const others = el("table", "pause-table");
    for (const upgrade of notTaken) {
      const cells: (string | HTMLElement)[] = [upgrade.name, el("span", "pause-item-desc", `Per level: ${upgrade.description}`)];
      if (this.devMode) {
        cells.push(
          button("Add", () => {
            setStatLineLevel(player, upgrade.id, 1);
            this.render();
          }),
        );
      }
      others.append(row(cells));
    }
    this.body.append(others);

    if (this.devMode && player.statLines.size > 0) {
      const actions = el("div", "pause-actions");
      actions.append(
        button("Remove all stat lines", () => {
          for (const id of [...player.statLines.keys()]) {
            setStatLineLevel(player, id, 0);
          }
          this.render();
        }),
      );
      this.body.append(actions);
    }
  }

  private renderItems(player: Player): void {
    const table = el("table", "pause-table");
    const header = ["#", "Item", "Level", "Stats (current values)"];
    table.append(row(this.devMode ? [...header, ""] : header, true));

    const addItemRow = (equipped: EquippedItem, label: string, remove: () => void) => {
      const params = itemParamList(equipped.item, equipped.level, player);
      const name = el("div", "pause-item-name", equipped.item.kind === "active" ? `${equipped.item.name} (active, SPACE)` : equipped.item.name);
      const nameCell = el("div");
      nameCell.append(name, el("div", "pause-item-desc", equipped.item.description));

      const maxLevel = getMaxLevel(equipped.item);
      const level = el("span", "pause-level");
      if (this.devMode && maxLevel > 1) {
        const changeLevel = (delta: number) => {
          if (equipped.setLevel(equipped.level + delta)) {
            this.render();
          }
        };
        level.append(button("−", () => changeLevel(-1)), ` ${equipped.level}/${maxLevel} `, button("+", () => changeLevel(1)));
      } else {
        level.textContent = `${equipped.level}/${maxLevel}`;
      }

      const cells: (string | HTMLElement)[] = [label, nameCell, level, params];
      if (this.devMode) {
        cells.push(
          button("Remove", () => {
            remove();
            this.render();
          }),
        );
      }
      table.append(row(cells));
    };

    if (player.activeItem) {
      addItemRow(player.activeItem, "A", () => player.unequipActive());
    }
    player.passiveItems.forEach((equipped, slotIndex) => {
      addItemRow(equipped, String(slotIndex + 1), () => player.unequipPassive(slotIndex));
    });

    if (!player.activeItem && player.passiveItems.length === 0) {
      this.body.append(el("p", "pause-note", "No items equipped."));
    } else {
      this.body.append(table);
    }

    if (!this.devMode) {
      return;
    }

    const select = el("select", "pause-input pause-select");
    for (const itemId of ITEM_IDS) {
      const item = ITEM_DEFINITIONS[itemId];
      // Only one active item can be equipped, so adding one replaces the current one.
      const option = el("option", "", item.kind === "active" ? `${item.name} (active, replaces current)` : item.name);
      option.value = itemId;
      select.append(option);
    }
    const actions = el("div", "pause-actions");
    actions.append(
      select,
      button("Add item", () => {
        player.equipItem(select.value as ItemId);
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
