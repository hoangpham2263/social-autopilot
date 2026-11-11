// Reload and Update at the top right of the page, on macOS and Windows; Update turns green with the version once a
// newer one is out. Both work through the app's server (src/server.mjs). The setup (Codex sign-in, Node.js, Codex CLI)
// lives in the Settings tab: when something is missing a banner says so and Settings opens by itself.
// Writes carry the session token the server puts in the page (meta sa-token); without it the server refuses.
const saPost = () => ({ method: "POST", headers: { "content-type": "application/json", "x-sa-token": document.querySelector('meta[name="sa-token"]')?.content || "" } });
(() => {
  // A page laid out for a minimum size (<body data-fit="960x680">) scales down to fit a smaller window instead of
  // being squeezed or cut off; below 60% it stops shrinking and scrolls. Its height, a
  // 100vh layout, is set to the scaled window's.
  const fit = /^(\d+)x(\d+)$/.exec(document.body?.dataset.fit || "");
  if (fit) {
    const [w, h] = [Number(fit[1]), Number(fit[2])];
    const apply = () => {
      const zoom = Math.max(0.6, Math.min(1, innerWidth / w, innerHeight / h));
      document.documentElement.style.zoom = zoom === 1 ? "" : String(zoom);
      document.body.style.height = zoom === 1 ? "" : `${Math.max(h, innerHeight / zoom)}px`;
      document.body.style.overflow = innerWidth / zoom < w - 1 || innerHeight / zoom < h - 1 ? "auto" : "";
      document.documentElement.style.overflow = document.body.style.overflow;
    };
    apply();
    addEventListener("resize", apply);
  }
  if (!location.protocol.startsWith("http")) return;
  const header = document.querySelector("header");
  if (!header) return;
  // Inline 16px icons (Lucide-style "refresh-cw" and "download"), stroke currentColor; a label is set with setLabel().
  const ICON = { reload: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>', update: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>' };
  const setLabel = (b, name, text) => { b.innerHTML = `<svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg><span></span>`; b.lastChild.textContent = text; };
  const btn = Object.assign(document.createElement("button"), { type: "button", className: "btn update" });
  setLabel(btn, "update", "Update");
  // Reload: the server starts again on the files as they are now and the page loads afresh (after an update, or when
  // the page looks out of date).
  const reload = Object.assign(document.createElement("button"), { type: "button", className: "btn reload" });
  setLabel(reload, "reload", "Reload");
  header.append(reload, btn);
  reload.onclick = async () => {
    reload.disabled = true;
    setLabel(reload, "reload", "Reloading…");
    const r = await fetch("/api/reload", saPost()).catch(() => null);
    if (!r || !r.ok) return location.reload();
    const wait = () => fetch("/api/root").then((x) => (x.ok ? location.reload() : setTimeout(wait, 400))).catch(() => setTimeout(wait, 400));
    setTimeout(wait, 900);
  };
  // The window title carries the installed version: "Social Autopilot v1.0.0".
  fetch("/api/root").then((r) => r.json()).then((r) => { if (r.version && !document.title.endsWith(r.version)) document.title = `${document.title} ${r.version}`; }).catch(() => {});
  // Setup check (Codex sign-in, Node.js, Codex CLI): a banner only when something is missing, and Settings opens.
  const status = document.getElementById("setupStatus");
  const STEP_NAMES = { node: "Node.js", codex: "Codex CLI", login: "Codex sign-in" };
  const openSettings = () => (window.saOpenSettings ? window.saOpenSettings() : (location.href = "/"));
  let setupRequest;
  function requestSetup() {
    if (setupRequest) return setupRequest;
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 50000);
    setupRequest = fetch('/api/setup', { ...saPost(), signal: abort.signal, cache: 'no-store' })
      .then(async response => {
        const report = await response.json();
        if (!response.ok) return { error: report.error || 'Setup could not be checked. Use Re-check in Settings.' };
        if (!Array.isArray(report.Steps) || Object.keys(STEP_NAMES).some(id => !report.Steps.some(step => step.Id === id))) return { error: 'Incomplete setup result. Use Re-check in Settings.' };
        return report;
      })
      .catch(error => ({ error: error.name === 'AbortError' ? 'Setup check timed out. Use Re-check in Settings.' : 'Lost connection to the app. Restart Social Autopilot.' }))
      .finally(() => { clearTimeout(timer); setupRequest = null; });
    return setupRequest;
  }
  async function refreshStatus() {
    if (!status) return;
    status.className = "setup-status";
    status.hidden = true; // shown only when something is wrong
    const report = await requestSetup();
    const steps = [].concat(report?.Steps || []);
    if (!steps.length) { status.hidden = false; status.innerHTML = `<span class="mark">!</span><span class="text">${report?.error || "Setup could not be checked."}</span><button class="btn" type="button">Open Settings</button>`; status.querySelector("button").onclick = openSettings; return; }
    const missing = steps.filter((s) => s.Id in STEP_NAMES && s.State !== "ok" && s.State !== "warn").map((s) => STEP_NAMES[s.Id]);
    if (!missing.length) return;
    status.hidden = false;
    status.className = "setup-status todo";
    status.innerHTML = `<span class="mark">✖</span><span class="text">Setup incomplete: ${missing.join(", ")}.</span><button class="btn primary" type="button">Open Settings</button>`;
    status.querySelector("button").onclick = openSettings;
    openSettings();
  }
  refreshStatus();
  let next = "", current = "";
  const show = () => { setLabel(btn, "update", next ? `Update ${next}` : "Update"); btn.classList.toggle("primary", !!next); };
  const check = () => fetch("/api/update-check").then((r) => (r.ok ? r.json() : Promise.reject())).then((r) => { next = r.next || ""; current = r.current || ""; show(); return true; }).catch(() => false);
  setTimeout(check, 3000);
  setInterval(check, 6 * 3600 * 1000);

  // Check, then download and install with a running bar.
  btn.onclick = async () => {
    const shade = Object.assign(document.createElement("div"), { className: "shade" });
    shade.innerHTML = `<div class="dialog" role="dialog" aria-label="Update"><div class="status"></div><div class="bar"><span></span></div><div class="actions"><button class="btn primary" type="button" hidden>Update</button><button class="btn" type="button">Close</button></div></div>`;
    document.body.append(shade);
    const [status, bar, go, close] = [".status", ".bar", ".btn.primary", ".btn:not(.primary)"].map((s) => shade.querySelector(s));
    close.onclick = () => { if (!close.disabled) shade.remove(); };
    status.textContent = "Checking for a new version…";
    if (!(await check())) { bar.hidden = true; status.textContent = "Could not reach GitHub to check for a new version. Check the network and try again."; return; }
    bar.hidden = true;
    if (!next) { status.textContent = current ? `You have the latest version (${current}).` : "No release has been published yet, so there is nothing to update."; return; }
    status.textContent = `Version ${next} is available (you have ${current || "the current one"}).`;
    go.hidden = false; go.focus();
    go.onclick = async () => {
      status.textContent = `Downloading and installing ${next}…`;
      bar.hidden = false; go.hidden = true; close.disabled = true;
      const r = await fetch("/api/update", saPost()).catch(() => null);
      if (!r || !r.ok) {
        bar.hidden = true; close.disabled = false; go.textContent = "Try again"; go.hidden = false;
        status.textContent = "Not updated. Check the network and try again.";
        return;
      }
      // The server restarts on the new files; the page reloads once it answers again.
      status.textContent = "Updated. Reopening…";
      const wait = () => fetch("/api/root").then((x) => (x.ok ? location.reload() : setTimeout(wait, 500))).catch(() => setTimeout(wait, 500));
      setTimeout(wait, 1200);
    };
  };
})();
