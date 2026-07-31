// DOM overlays: faction select, teams menu, dialogue, code entry, info, ending.
// Each returns a promise so the caller can drive flow linearly.

import {
  TEAM, PLAYER_TEAM_CAP, ENEMY_TEAM_CAP, playerTeamCount, enemyTeamCount,
  canCloseTeams, assignTeam, neutralCount,
} from "./state.js";

const root = document.getElementById("overlay");
let openCount = 0;

export const isOverlayOpen = () => openCount > 0;

function panel(className) {
  const wrap = document.createElement("div");
  wrap.className = `overlay-layer ${className}`;
  return wrap;
}

function mount(layer) {
  openCount++;
  root.appendChild(layer);
  root.classList.add("is-visible");
  return () => {
    layer.remove();
    openCount = Math.max(0, openCount - 1);
    if (openCount === 0) root.classList.remove("is-visible");
  };
}

/** Wires arrow/Enter navigation over a list of buttons; mouse works natively. */
function navigable(container, buttons, onPick, onCancel) {
  let i = buttons.findIndex((b) => !b.disabled);
  const paint = () => buttons.forEach((b, k) => b.classList.toggle("is-selected", k === i));
  paint();

  buttons.forEach((b, k) => {
    b.addEventListener("mouseenter", () => { if (!b.disabled) { i = k; paint(); } });
    b.addEventListener("click", () => { if (!b.disabled) onPick(k); });
  });

  const step = (delta) => {
    for (let n = 0; n < buttons.length; n++) {
      i = (i + delta + buttons.length) % buttons.length;
      if (!buttons[i].disabled) break;
    }
    paint();
  };

  const onKey = (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") step(-1);
    else if (e.key === "Enter") { if (i >= 0 && !buttons[i].disabled) onPick(i); }
    else if (e.key === "Escape" && onCancel) onCancel();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
}

// --- Faction select --------------------------------------------------------

export function showFactionSelect() {
  return new Promise((resolve) => {
    const layer = panel("layer-faction");
    layer.innerHTML = `
      <div class="dialog dialog-wide">
        <h1>Choose your side</h1>
        <p class="muted">Chanko fights under one banner. This cannot be changed later.</p>
        <div class="faction-choices"></div>
      </div>`;
    const choices = layer.querySelector(".faction-choices");
    const buttons = ["pirate", "viking"].map((f) => {
      const b = document.createElement("button");
      b.className = "faction-card";
      b.type = "button";
      b.innerHTML = `
        <img src="./assets/sprites/npc/${f}/idle.png" alt="">
        <span>${f[0].toUpperCase() + f.slice(1)}</span>`;
      choices.appendChild(b);
      return b;
    });

    const close = mount(layer);
    const unbind = navigable(layer, buttons, (k) => {
      unbind(); close(); resolve(k === 0 ? "pirate" : "viking");
    });
  });
}

// --- Teams menu ------------------------------------------------------------

export function showTeams(state, assets, { forced = false } = {}) {
  return new Promise((resolve) => {
    const layer = panel("layer-teams");
    const opposing = state.faction === "pirate" ? "viking" : "pirate";

    layer.innerHTML = `
      <div class="dialog dialog-teams">
        <header>
          <h2>Teams</h2>
          <p class="muted" id="teams-hint"></p>
        </header>
        <div class="team-columns">
          <section class="team-col team-player">
            <h3>${state.faction.toUpperCase()} <span class="count"></span></h3>
            <ul></ul>
          </section>
          <section class="team-col team-neutral">
            <h3>NEUTRAL <span class="count"></span></h3>
            <ul></ul>
          </section>
          <section class="team-col team-enemy">
            <h3>${opposing.toUpperCase()} <span class="count"></span></h3>
            <ul></ul>
          </section>
        </div>
        <footer>
          <button type="button" class="menu-button" id="teams-close">Close</button>
        </footer>
      </div>`;

    const cols = {
      [TEAM.PLAYER]: layer.querySelector(".team-player ul"),
      [TEAM.NEUTRAL]: layer.querySelector(".team-neutral ul"),
      [TEAM.ENEMY]: layer.querySelector(".team-enemy ul"),
    };
    const counts = {
      [TEAM.PLAYER]: layer.querySelector(".team-player .count"),
      [TEAM.NEUTRAL]: layer.querySelector(".team-neutral .count"),
      [TEAM.ENEMY]: layer.querySelector(".team-enemy .count"),
    };
    const closeBtn = layer.querySelector("#teams-close");
    const hint = layer.querySelector("#teams-hint");

    function render() {
      for (const ul of Object.values(cols)) ul.innerHTML = "";

      // Chanko is pinned to the top of the player column and cannot be moved.
      const chanko = document.createElement("li");
      chanko.className = "team-entry is-fixed";
      chanko.innerHTML = `<span class="name">Chanko</span><span class="tag">leader</span>`;
      cols[TEAM.PLAYER].appendChild(chanko);

      // Sorted by the person's real name, not the internal id.
      const displayName = (id) =>
        (assets.byId[id] && assets.byId[id]["npc-label"]) || id;
      const profession = (id) =>
        (assets.byId[id] && assets.byId[id]["npc-profession"]) || "";

      const ids = Object.keys(state.teams).sort((a, b) =>
        displayName(a).localeCompare(displayName(b))
      );

      for (const label of ids) {
        const team = state.teams[label];
        const li = document.createElement("li");
        li.className = "team-entry";

        const move = (to) => {
          const result = assignTeam(state, label, to);
          if (result !== true) {
            hint.textContent = result === "player-full"
              ? `Your team is full — ${PLAYER_TEAM_CAP} including Chanko.`
              : `The opposing team is full — ${ENEMY_TEAM_CAP} maximum.`;
            hint.classList.add("warn");
            return;
          }
          render();
        };

        const left = document.createElement("button");
        left.type = "button";
        left.className = "arrow";
        left.textContent = "◀";
        left.disabled = team === TEAM.PLAYER;
        left.addEventListener("click", () => move(team === TEAM.ENEMY ? TEAM.NEUTRAL : TEAM.PLAYER));

        const right = document.createElement("button");
        right.type = "button";
        right.className = "arrow";
        right.textContent = "▶";
        right.disabled = team === TEAM.ENEMY;
        right.addEventListener("click", () => move(team === TEAM.PLAYER ? TEAM.NEUTRAL : TEAM.ENEMY));

        const name = document.createElement("span");
        name.className = "name";
        name.textContent = displayName(label);

        const role = document.createElement("span");
        role.className = "tag";
        role.textContent = profession(label);

        li.append(left, name, role, right);
        cols[team].appendChild(li);
      }

      counts[TEAM.PLAYER].textContent = `${playerTeamCount(state)} / ${PLAYER_TEAM_CAP}`;
      counts[TEAM.NEUTRAL].textContent = `${neutralCount(state)}`;
      counts[TEAM.ENEMY].textContent = `${enemyTeamCount(state)} / ${ENEMY_TEAM_CAP}`;

      const closable = canCloseTeams(state);
      closeBtn.disabled = !closable;
      if (!hint.classList.contains("warn")) {
        hint.textContent = closable
          ? "Move anyone with the arrows. Press T or Close when you are done."
          : `Assign all ${neutralCount(state)} remaining neutral characters before closing.`;
      }
      hint.classList.remove("warn");
    }

    render();
    const close = mount(layer);

    const tryClose = () => {
      if (!canCloseTeams(state)) {
        hint.textContent = "You cannot leave anyone neutral.";
        hint.classList.add("warn");
        return;
      }
      window.removeEventListener("keydown", onKey, true);
      close();
      resolve();
    };

    const onKey = (e) => {
      if (e.key === "t" || e.key === "T" || e.key === "Escape") {
        // Stop here, or the same keypress bubbles to the global handler, which
        // sees the overlay already closed and reopens it immediately.
        e.preventDefault();
        e.stopPropagation();
        tryClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    closeBtn.addEventListener("click", tryClose);
    if (forced) hint.textContent = `Assign all ${neutralCount(state)} characters to a side.`;
  });
}

// --- Dialogue --------------------------------------------------------------

/**
 * options: [{ id, label, disabled?, note? }]
 * Resolves with the chosen id, or null if dismissed with Escape.
 */
export function showDialogue({ portraitSrc, name, profession, text, options, dismissible = true }) {
  return new Promise((resolve) => {
    const layer = panel("layer-dialogue");
    layer.innerHTML = `
      <div class="dialog dialog-npc${portraitSrc ? "" : " no-portrait"}">
        ${portraitSrc ? `<div class="npc-portrait-pane"><img src="${portraitSrc}" alt=""></div>` : ""}
        <div class="npc-body">
          <header class="npc-id">
            <h2>${name}</h2>
            ${profession ? `<p class="profession">${profession}</p>` : ""}
          </header>
          <p class="npc-text"></p>
          <div class="npc-options"></div>
        </div>
      </div>`;
    layer.querySelector(".npc-text").textContent = text;

    const box = layer.querySelector(".npc-options");
    const buttons = options.map((o) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "option";
      b.disabled = !!o.disabled;
      b.innerHTML = `<span>${o.label}</span>${o.note ? `<em>${o.note}</em>` : ""}`;
      box.appendChild(b);
      return b;
    });

    const close = mount(layer);
    const finish = (value) => { unbind(); close(); resolve(value); };
    const unbind = navigable(
      layer, buttons,
      (k) => finish(options[k].id),
      dismissible ? () => finish(null) : null
    );
  });
}

// --- Six-digit code entry --------------------------------------------------

export function showCodeInput({ title, subtitle }) {
  return new Promise((resolve) => {
    const layer = panel("layer-code");
    layer.innerHTML = `
      <div class="dialog dialog-code">
        <h2>${title}</h2>
        <p class="muted">${subtitle}</p>
        <input type="text" inputmode="numeric" maxlength="6" autocomplete="off" placeholder="000000">
        <div class="code-actions">
          <button type="button" class="menu-button" data-act="submit">Submit</button>
          <button type="button" class="menu-button" data-act="cancel">Cancel</button>
        </div>
      </div>`;

    const input = layer.querySelector("input");
    const close = mount(layer);
    const finish = (v) => { window.removeEventListener("keydown", onKey, true); close(); resolve(v); };

    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 6);
    });
    layer.querySelector('[data-act="submit"]').addEventListener("click", () => finish(input.value));
    layer.querySelector('[data-act="cancel"]').addEventListener("click", () => finish(null));

    const onKey = (e) => {
      if (e.key === "Enter") { e.preventDefault(); finish(input.value); }
      else if (e.key === "Escape") { e.preventDefault(); finish(null); }
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    setTimeout(() => input.focus(), 0);
  });
}

// --- Simple message --------------------------------------------------------

export function showMessage(title, text) {
  return showDialogue({
    portraitSrc: "",
    name: title,
    profession: "",
    text,
    options: [{ id: "ok", label: "Continue" }],
  });
}

// --- Information screen ----------------------------------------------------

/** One block per page, paged left/right with the arrow keys or the controls. */
export function showInfo(info) {
  return new Promise((resolve) => {
    const pages = info.blocks;
    let page = 0;

    const layer = panel("layer-info");
    layer.innerHTML = `
      <div class="dialog dialog-info">
        <header class="info-head">
          <p class="info-kicker">${info.title}</p>
          <h2 class="info-title"></h2>
        </header>
        <div class="info-page"><p class="info-text"></p></div>
        <nav class="info-nav">
          <button type="button" class="pager" data-act="prev" aria-label="Previous page">◀</button>
          <ol class="info-dots"></ol>
          <button type="button" class="pager" data-act="next" aria-label="Next page">▶</button>
        </nav>
        <footer class="info-foot">
          <span class="muted">← → to turn pages · I or Esc to close</span>
          <button type="button" class="menu-button" id="info-close">Close</button>
        </footer>
      </div>`;

    const titleEl = layer.querySelector(".info-title");
    const textEl = layer.querySelector(".info-text");
    const dotsEl = layer.querySelector(".info-dots");
    const prevBtn = layer.querySelector('[data-act="prev"]');
    const nextBtn = layer.querySelector('[data-act="next"]');

    const dots = pages.map((_, i) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dot";
      b.textContent = String(i + 1);
      b.addEventListener("click", () => go(i));
      li.appendChild(b);
      dotsEl.appendChild(li);
      return b;
    });

    function go(i) {
      page = Math.max(0, Math.min(pages.length - 1, i));
      const b = pages[page];
      titleEl.textContent = b.heading;
      textEl.textContent = b.text;
      dots.forEach((d, k) => d.classList.toggle("is-current", k === page));
      prevBtn.disabled = page === 0;
      nextBtn.disabled = page === pages.length - 1;
    }

    prevBtn.addEventListener("click", () => go(page - 1));
    nextBtn.addEventListener("click", () => go(page + 1));
    go(0);

    const close = mount(layer);
    const finish = () => { window.removeEventListener("keydown", onKey, true); close(); resolve(); };
    const onKey = (e) => {
      const digit = /^[0-9]$/.test(e.key) ? +e.key : null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown") go(page + 1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") go(page - 1);
      else if (digit !== null && digit >= 1 && digit <= pages.length) go(digit - 1);
      else if (e.key === "i" || e.key === "I" || e.key === "Escape") finish();
      else return;
      // Handled — stop before the global handler sees it and reopens this.
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    layer.querySelector("#info-close").addEventListener("click", finish);
  });
}

// --- Ending ----------------------------------------------------------------

export function showEnding() {
  const layer = panel("layer-ending");
  layer.innerHTML = `<div class="ending-text">You WIN. But your prize will arrive next week. Blame UPS.</div>`;
  mount(layer);
  requestAnimationFrame(() => layer.classList.add("is-lit"));
}
