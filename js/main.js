// Entry point. Scaffold only — real game logic lands after the spec session.

const SAVE_KEY = "chanko.save.v1";

const screens = {
  start: document.getElementById("start-screen"),
  game: document.getElementById("game-screen"),
};

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.remove("is-active"));
  screens[name].classList.add("is-active");
}

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function startGame(save) {
  showScreen("game");

  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff";
  ctx.font = "24px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(
    save ? "Continuing saved game…" : "New game — scaffold running.",
    canvas.width / 2,
    canvas.height / 2
  );
}

function init() {
  const save = loadSave();
  document.getElementById("btn-continue").disabled = !save;

  document.getElementById("btn-start").addEventListener("click", () => startGame(null));
  document.getElementById("btn-continue").addEventListener("click", () => startGame(loadSave()));
}

init();
