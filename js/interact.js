// Conversation and quest flow. The game never rolls dice — the player reports
// the outcome of their own physical roll.

import {
  QUEST, TRIAL, dcFor, DC_WARLOCK_HINT, currentTrialIndex, completeTrial, save,
} from "./state.js";
import { showDialogue, showCodeInput, showMessage } from "./ui.js";

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh"];

/** A self-reported check. Resolves true on Success, false on Failure, null if dismissed. */
async function reportedCheck({ portraitSrc, name, profession, dc, ability }) {
  const choice = await showDialogue({
    portraitSrc, name, profession,
    text: `Roll a d20. ${ability} check, DC ${dc}. Report your result honestly.`,
    options: [
      { id: "success", label: "Success", note: `met or beat DC ${dc}` },
      { id: "failure", label: "Failure", note: `under DC ${dc}` },
      { id: "back", label: "Step away" },
    ],
  });
  if (choice === "success") return true;
  if (choice === "failure") return false;
  return null;
}

// --- Standard NPCs ---------------------------------------------------------

async function talkToNpc(state, npc) {
  const label = npc["npc-label"];
  const portraitSrc = `./${npc["npc-portrait-reference"]}`;
  const name = npc["npc-nickname"] || label;
  const profession = npc["npc-profession"] || "";

  for (;;) {
    const q = state.quests[label];
    const options = [];
    let text;

    if (q.state === QUEST.DONE) {
      text = npc["npc-quest-completion-message"];
    } else if (q.state === QUEST.ACCEPTED) {
      text = npc["npc-quest-information"];
      options.push({ id: "complete", label: "I have completed your quest" });
    } else {
      text = npc["npc-greeting-text"];
      options.push({
        id: "sweettalk",
        label: "Sweet talk",
        disabled: q.sweetTalkFailed,
        note: q.sweetTalkFailed ? "they will not hear it again" : `DC ${dcFor(state, label)}`,
      });
      options.push({ id: "bribe", label: "Bribe", note: "1 gold coin" });
    }
    options.push({ id: "leave", label: "Leave" });

    const choice = await showDialogue({ portraitSrc, name, profession, text, options });

    if (choice === "leave" || choice === null) return false;

    if (choice === "sweettalk") {
      const ok = await reportedCheck({
        portraitSrc, name, profession,
        dc: dcFor(state, label), ability: "Charisma",
      });
      if (ok === null) continue;
      if (ok) {
        q.state = QUEST.ACCEPTED;
        save(state);
        await showDialogue({
          portraitSrc, name, profession,
          text: npc["npc-quest-information"],
          options: [{ id: "ok", label: "I will do it" }],
        });
      } else {
        q.sweetTalkFailed = true;
        save(state);
        await showDialogue({
          portraitSrc, name, profession,
          text: "Your words fall flat. There is only one way to change their mind now.",
          options: [{ id: "ok", label: "Continue" }],
        });
      }
      continue;
    }

    if (choice === "bribe") {
      q.state = QUEST.ACCEPTED;
      save(state);
      await showDialogue({
        portraitSrc, name, profession,
        text: npc["npc-quest-information"],
        options: [{ id: "ok", label: "I will do it" }],
      });
      continue;
    }

    if (choice === "complete") {
      const code = await showCodeInput({
        title: "Enter the completion code",
        subtitle: `Six digits, from ${name}'s quest.`,
      });
      if (code === null) continue;
      if (code === npc["npc-quest-completion-code"]) {
        q.state = QUEST.DONE;
        save(state);
        await showDialogue({
          portraitSrc, name, profession,
          text: npc["npc-quest-completion-message"],
          options: [{ id: "ok", label: "Continue" }],
        });
      } else {
        await showMessage("Wrong code", "That is not the right code. Try again.");
      }
    }
  }
}

// --- Warlock ---------------------------------------------------------------

async function talkToWarlock(state, warlock) {
  const portraitSrc = `./${warlock["npc-portrait-reference"]}`;
  const name = warlock["npc-nickname"] || "Warlock";
  const profession = warlock["npc-profession"] || "Warlock";

  for (;;) {
    const i = currentTrialIndex(state);
    if (i === -1) {
      await showDialogue({
        portraitSrc, name, profession,
        text: warlock["npc-all-trials-complete-text"],
        options: [{ id: "leave", label: "Leave" }],
      });
      return false;
    }

    const trialState = state.warlock.trials[i];
    const trialData = warlock.trials[i];
    const options = [];
    let text;

    const trialName = trialData["trial-name"] || "";
    if (trialState.state === TRIAL.AVAILABLE) {
      text = i === 0 ? warlock["npc-greeting-text"] : trialData["trial-information"];
      options.push({ id: "accept", label: `I accept the ${ORDINALS[i]} trial`, note: trialName });
    } else {
      text = trialData["trial-information"];
      options.push({ id: "complete", label: "I have completed your quest", note: trialName });
    }

    options.push({
      id: "hint",
      label: "Ask for a hint",
      note: trialState.hintUnlocked ? "already granted" : `INT check, DC ${DC_WARLOCK_HINT}`,
    });
    options.push({ id: "leave", label: "Leave" });

    const choice = await showDialogue({ portraitSrc, name, profession, text, options });
    if (choice === "leave" || choice === null) return false;

    if (choice === "accept") {
      trialState.state = TRIAL.ACCEPTED;
      save(state);
      await showDialogue({
        portraitSrc, name, profession,
        text: trialData["trial-information"],
        options: [{ id: "ok", label: "It will be done" }],
      });
      continue;
    }

    if (choice === "hint") {
      if (!trialState.hintUnlocked) {
        const ok = await reportedCheck({
          portraitSrc, name, profession,
          dc: DC_WARLOCK_HINT, ability: "Intelligence",
        });
        if (ok === null) continue;
        if (!ok) {
          await showDialogue({
            portraitSrc, name, profession,
            text: "The Warlock says nothing useful. Try again when your mind is sharper.",
            options: [{ id: "ok", label: "Continue" }],
          });
          continue;
        }
        trialState.hintUnlocked = true;
        save(state);
      }
      await showDialogue({
        portraitSrc, name, profession,
        text: trialData["trial-hint"],
        options: [{ id: "ok", label: "Continue" }],
      });
      continue;
    }

    if (choice === "complete") {
      const code = await showCodeInput({
        title: `Code for the ${ORDINALS[i]} trial`,
        subtitle: "Six digits.",
      });
      if (code === null) continue;
      if (code === trialData["trial-completion-code"]) {
        completeTrial(state, i);
        save(state);
        await showDialogue({
          portraitSrc, name, profession,
          text: trialData["trial-completion-message"],
          options: [{ id: "ok", label: "Continue" }],
        });
        if (state.won) return true;
      } else {
        await showMessage("Wrong code", "That is not the right code. Try again.");
      }
    }
  }
}

/** Returns true when this conversation triggered the ending. */
export function interactWith(state, assets, label) {
  if (label === "warlock") return talkToWarlock(state, assets.warlock);
  const npc = assets.npcs.find((n) => n["npc-label"] === label);
  return npc ? talkToNpc(state, npc) : Promise.resolve(false);
}
