const BASE = "https://pc-wrangler.vercel.app";
const MAX_CODES = 20;

const codeEl = document.getElementById("code");
const statusEl = document.getElementById("status");
const campsSection = document.getElementById("camps-section");
const campRows = document.getElementById("camp-rows");
const linkSection = document.getElementById("link-section");
const linkRows = document.getElementById("link-rows");
const linkStatus = document.getElementById("link-status");

let codes = [];
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
      await setCodes(codes);
      renderCampaigns();
      await renderLinking();
    });
    row.appendChild(rm);

    campRows.appendChild(row);

    fetchCampaign(code).then((info) => {
      name.textContent = `${info.name}  \u00b7  ${code}`;
    });
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
  await setCodes(codes); // persist any migrated legacy code
  renderCampaigns();
  await renderLinking();
})();
