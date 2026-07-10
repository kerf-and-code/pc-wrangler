const BASE = "https://pc-wrangler.vercel.app";

const codeEl = document.getElementById("code");
const statusEl = document.getElementById("status");
const linkSection = document.getElementById("link-section");
const linkRows = document.getElementById("link-rows");
const linkStatus = document.getElementById("link-status");

let shareCode = "";

chrome.storage.sync.get(["shareCode"], (cfg) => {
  if (cfg && cfg.shareCode) {
    codeEl.value = cfg.shareCode;
    shareCode = cfg.shareCode;
  }
  refreshLinking();
});

document.getElementById("save").addEventListener("click", () => {
  const val = (codeEl.value || "").trim();
  if (!val) {
    statusEl.textContent = "Enter your campaign code.";
    statusEl.style.color = "#E07A5F";
    return;
  }
  chrome.storage.sync.set({ shareCode: val }, () => {
    shareCode = val;
    statusEl.textContent = "Saved. You're set, roll on D&D Beyond.";
    statusEl.style.color = "#8FBF8F";
    refreshLinking();
  });
});

function getUnmatched() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["unmatched"], (st) => resolve((st && st.unmatched) || {}));
  });
}

function dropUnmatched(ddbId) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["unmatched"], (st) => {
      const map = (st && st.unmatched) || {};
      delete map[ddbId];
      chrome.storage.local.set({ unmatched: map }, resolve);
    });
  });
}

async function refreshLinking() {
  linkRows.innerHTML = "";
  linkStatus.textContent = "";
  linkStatus.style.color = "#A597BD";

  if (!shareCode) {
    linkSection.style.display = "none";
    return;
  }

  const unmatched = await getUnmatched();
  const ids = Object.keys(unmatched);
  if (ids.length === 0) {
    linkSection.style.display = "none";
    return;
  }

  linkSection.style.display = "block";
  linkStatus.textContent = "Loading characters...";

  let characters = [];
  try {
    const res = await fetch(`${BASE}/api/vtt/self-link?share_code=${encodeURIComponent(shareCode)}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(data.characters)) {
      characters = data.characters;
    } else {
      linkStatus.textContent = data.error || "Couldn't load characters.";
      return;
    }
  } catch {
    linkStatus.textContent = "Network error loading characters.";
    return;
  }

  const available = characters.filter((c) => !c.ddb_character_id);
  linkStatus.textContent = "";

  for (const id of ids) {
    const actor = unmatched[id] || "Unknown roller";

    const row = document.createElement("div");
    row.className = "link-row";

    const who = document.createElement("div");
    who.className = "link-who";
    who.textContent = actor;
    row.appendChild(who);

    const sel = document.createElement("select");
    sel.className = "link-select";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "Choose your character...";
    sel.appendChild(opt0);
    for (const c of available) {
      const o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.name;
      sel.appendChild(o);
    }
    row.appendChild(sel);

    const btn = document.createElement("button");
    btn.className = "link-btn";
    btn.textContent = "Link";
    btn.addEventListener("click", () => linkOne(id, sel.value, btn));
    row.appendChild(btn);

    linkRows.appendChild(row);
  }

  if (available.length === 0) {
    linkStatus.textContent = "No unlinked characters. Ask your GM to add yours in Six Axes, then reopen this.";
  }
}

async function linkOne(ddbId, characterId, btn) {
  if (!characterId) {
    linkStatus.style.color = "#E07A5F";
    linkStatus.textContent = "Pick a character first.";
    return;
  }
  btn.disabled = true;
  btn.textContent = "Linking...";
  try {
    const res = await fetch(`${BASE}/api/vtt/self-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ share_code: shareCode, ddb_character_id: ddbId, character_id: characterId }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.linked) {
      await dropUnmatched(ddbId);
      const extra =
        data.backfilled > 0
          ? ` (${data.backfilled} earlier roll${data.backfilled === 1 ? "" : "s"} attributed)`
          : "";
      linkStatus.style.color = "#8FBF8F";
      linkStatus.textContent = `Linked to ${data.character_name}${extra}.`;
      refreshLinking();
    } else {
      linkStatus.style.color = "#E07A5F";
      linkStatus.textContent = data.error || "Link failed. Try again.";
      btn.disabled = false;
      btn.textContent = "Link";
    }
  } catch {
    linkStatus.style.color = "#E07A5F";
    linkStatus.textContent = "Network error. Try again.";
    btn.disabled = false;
    btn.textContent = "Link";
  }
}
