const BASE = "https://www.six-axes.com";
const MAX_CODES = 20;

const codeEl = document.getElementById("code");
const statusEl = document.getElementById("status");
const campsSection = document.getElementById("camps-section");
const campRows = document.getElementById("camp-rows");
const linkSection = document.getElementById("link-section");
const linkRows = document.getElementById("link-rows");
const linkStatus = document.getElementById("link-status");

let codes = [];
// table code -> roll key (handed over on the table link page; see link-capture.js)
let keys = {};
// code -> { name, characters: [{ id, name, ddb_character_id }] }
const campCache = {};

function getCodes() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["shareCodes", "shareCode"], (cfg) => {
      let list = Array.isArray(cfg && cfg.shareCodes) ? cfg.shareCodes.slice() : [];
      if (cfg && cfg.shareCode && list.indexOf(cfg.shareCode) === -1) list.push(cfg.shareCode);
      const seen = {};
      list = list.filter((c) => { if (!c || seen[c]) return false; seen[c] = true; return true; }).slice(-MAX_CODES);
      resolve(list);
    });
  });
}
function setCodes(list) {
  return new Promise((resolve) => chrome.storage.sync.set({ shareCodes: list }, resolve));
}
function getKeys() {
  return new Promise((resolve) => chrome.storage.sync.get(["ingestKeys"], (cfg) => {
    const k = cfg && cfg.ingestKeys;
    resolve(k && typeof k === "object" ? k : {});
  }));
}
function setKeys(map) {
  return new Promise((resolve) => chrome.storage.sync.set({ ingestKeys: map }, resolve));
}
function getUnmatched() {
  return new Promise((resolve) => chrome.storage.local.get(["unmatched"], (st) => resolve((st && st.unmatched) || {})));
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

async function fetchCampaign(code) {
  if (campCache[code]) return campCache[code];
  try {
    const res = await fetch(`${BASE}/api/vtt/self-link?share_code=${encodeURIComponent(code)}`);
    const data = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(data.characters)) {
      campCache[code] = { name: data.campaign_name || code, characters: data.characters };
      return campCache[code];
    }
    return { name: code, characters: [], error: data.error || "Could not load." };
  } catch {
    return { name: code, characters: [], error: "Network error." };
  }
}

function renderCampaigns() {
  campRows.innerHTML = "";
  if (codes.length === 0) { campsSection.style.display = "none"; return; }
  campsSection.style.display = "block";

  for (const code of codes) {
    const row = document.createElement("div");
    row.className = "camp-row";

    const name = document.createElement("div");
    name.className = "camp-name";
    name.textContent = "Loading...";
    row.appendChild(name);

    const rm = document.createElement("button");
    rm.className = "camp-remove";
    rm.textContent = "Remove";
    rm.addEventListener("click", async () => {
      codes = codes.filter((c) => c !== code);
      delete campCache[code];
      delete keys[code];
      await setCodes(codes);
      await setKeys(keys);
      renderCampaigns();
      await renderLinking();
    });
    row.appendChild(rm);

    campRows.appendChild(row);

    fetchCampaign(code).then((info) => {
      name.textContent = `${info.name}  \u00b7  ${code}`;
    });

    // Verified when a roll key is saved for this table; otherwise say how to get one.
    const badge = document.createElement("div");
    badge.className = keys[code] ? "camp-badge ok" : "camp-badge";
    badge.textContent = keys[code] ? "Verified" : "Unverified";
    badge.title = keys[code]
      ? "Your rolls here count as verified."
      : "Open your table link while signed in to Six Axes and press Connect.";
    row.insertBefore(badge, rm);
  }
}

async function renderLinking() {
  linkRows.innerHTML = "";
  linkStatus.textContent = "";
  linkStatus.style.color = "#A597BD";

  if (codes.length === 0) { linkSection.style.display = "none"; return; }

  const unmatched = await getUnmatched();
  const ids = Object.keys(unmatched);
  if (ids.length === 0) { linkSection.style.display = "none"; return; }

  linkSection.style.display = "block";
  linkStatus.textContent = "Loading characters...";

  // Gather unlinked characters across every saved campaign.
  const available = []; // { code, campaignName, id, name }
  for (const code of codes) {
    const info = await fetchCampaign(code);
    for (const c of info.characters || []) {
      if (!c.ddb_character_id) available.push({ code, campaignName: info.name, id: c.id, name: c.name });
    }
  }
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
    available.forEach((c, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = `${c.campaignName} \u00b7 ${c.name}`;
      sel.appendChild(o);
    });
    row.appendChild(sel);

    const btn = document.createElement("button");
    btn.className = "link-btn";
    btn.textContent = "Link";
    btn.addEventListener("click", () => {
      if (sel.value === "") {
        linkStatus.style.color = "#E07A5F";
        linkStatus.textContent = "Pick a character first.";
        return;
      }
      linkOne(id, available[Number(sel.value)], btn);
    });
    row.appendChild(btn);

    linkRows.appendChild(row);
  }

  if (available.length === 0) {
    linkStatus.textContent = "No unlinked characters in your campaigns. Ask your GM to add yours in Six Axes, then reopen this.";
  }
}

async function linkOne(ddbId, choice, btn) {
  if (!choice) return;
  btn.disabled = true;
  btn.textContent = "Linking...";
  try {
    const res = await fetch(`${BASE}/api/vtt/self-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ share_code: choice.code, ddb_character_id: ddbId, character_id: choice.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.linked) {
      await dropUnmatched(ddbId);
      delete campCache[choice.code]; // refresh so the linked character drops from the picker
      const extra =
        data.backfilled > 0
          ? ` (${data.backfilled} earlier roll${data.backfilled === 1 ? "" : "s"} attributed)`
          : "";
      linkStatus.style.color = "#8FBF8F";
      linkStatus.textContent = `Linked to ${data.character_name}${extra}.`;
      await renderLinking();
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

// ---- Roll20 (2.4.0): an optional permission, asked for only when the player turns it on ----
const R20 = { origins: ["https://app.roll20.net/*"] };
const r20Btn = document.getElementById("r20-toggle");
const r20Text = document.getElementById("r20-text");
const r20Status = document.getElementById("r20-status");
async function renderRoll20() {
  const on = await chrome.permissions.contains(R20);
  r20Btn.textContent = on ? "Turn off Roll20" : "Turn on Roll20";
  r20Btn.className = on ? "r20-off" : "";
  r20Text.textContent = on
    ? "On. Rolls you make in the Roll20 chat go to whichever of your tables has a session open. Reload an open Roll20 game for it to start."
    : "Playing on Roll20? Turn this on and the rolls you make in the Roll20 chat go to your table too. Chrome asks first for access to Roll20.";
}
r20Btn.addEventListener("click", async () => {
  r20Status.textContent = "";
  const on = await chrome.permissions.contains(R20);
  const ok = on ? await chrome.permissions.remove(R20) : await chrome.permissions.request(R20);
  if (!ok && !on) { r20Status.style.color = "#E07A5F"; r20Status.textContent = "Chrome did not give access to Roll20, so it stays off."; }
  chrome.runtime.sendMessage({ type: "six-axes-roll20-sync" }, () => { void chrome.runtime.lastError; renderRoll20(); });
});

document.getElementById("save").addEventListener("click", async () => {
  const val = (codeEl.value || "").trim().toLowerCase().slice(0, 64);
  if (!val) {
    statusEl.textContent = "Enter a campaign code.";
    statusEl.style.color = "#E07A5F";
    return;
  }
  if (codes.indexOf(val) === -1) {
    codes = codes.concat([val]).slice(-MAX_CODES);
    delete campCache[val];
    await setCodes(codes);
  }
  codeEl.value = "";
  statusEl.textContent = "Added. Roll on D&D Beyond while a session is open.";
  statusEl.style.color = "#8FBF8F";
  renderCampaigns();
  await renderLinking();
});

(async function init() {
  codes = await getCodes();
  keys = await getKeys();
  await setCodes(codes); // persist any migrated legacy code
  renderCampaigns();
  await renderLinking();
  await renderRoll20();
})();
