// Cấu hình page (core/setup/page.html): the steps from setup-check.ps1 (POST /api/setup), a button on each that can be
// fixed or changed. "← Quay lại" goes to ?back= (the page it
// was opened from), so the menu and every tool share this one page.
(() => {
  const $ = (s) => document.querySelector(s);
  // Writes carry the session token the server puts in the page (meta sa-token); without it the server refuses.
  const headers = { "content-type": "application/json", "x-sa-token": document.querySelector('meta[name="sa-token"]')?.content || "" };
  const post = (path, data, method = "POST") => fetch(path, { method, headers, body: data ? JSON.stringify(data) : undefined }).then((r) => r.json()).catch(() => ({ error: "Không kết nối được." }));
  const el = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});
  // Only a page of this server: a path, never another site.
  const back = new URLSearchParams(location.search).get("back");
  const backUrl = back && back.startsWith("/") && !back.startsWith("//") ? back : "/";
  $(".back").onclick = () => { location.href = backUrl; };
  fetch("/api/root").then((r) => r.json()).then((r) => { if (r.version) document.title = `Cấu hình ${r.version}`; }).catch(() => {});

  // Which section each step is in, in this order; anything else the check adds goes under Cài đặt.
  const AI = ["login"];
  const BASE = ["node", "codex"];
  const marks = { ok: ["✔", "darkgreen"], fail: ["✖", "firebrick"], warn: ["!", "#b06000"] };
  const items = new Map();
  const item = (id, parent) => {
    const box = el("div", "item"), mark = el("span", "mark", "○"), body = el("div", "body"), side = el("div", "side");
    const name = el("div", "name"), detail = el("div", "detail", "Đang kiểm tra…"), uses = el("div", "uses"), extra = el("div");
    const fix = el("button", "btn", ""); fix.type = "button"; fix.hidden = true;
    body.append(name, detail, uses, extra); side.append(fix);
    box.append(mark, body, side);
    parent.append(box);
    const row = { box, mark, name, detail, uses, extra, fix, side };
    items.set(id, row);
    return row;
  };
  for (const id of AI) item(id, $("#ai"));
  for (const id of BASE) item(id, $("#base"));
  const NAMES = { login: "Codex (ChatGPT)", node: "Node.js", codex: "Codex CLI" };
  for (const [id, row] of items) row.name.textContent = NAMES[id];
  const LABELS = { install: "Cài", login: "Đăng nhập" };
  const WAIT = {
    install: "Đang cài…",
    login: "Đang mở trang đăng nhập ChatGPT trong Chrome…",
  };

  let checking = false;
  const check = async () => {
    if (checking) return;
    checking = true;
    $(".again").disabled = true;
    for (const row of items.values()) { row.mark.textContent = "○"; row.mark.style.color = ""; row.detail.textContent = "Đang kiểm tra…"; row.fix.hidden = true; }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 60000);
    const report = await fetch("/api/setup", { method: "POST", headers, signal: abort.signal, cache: "no-store" }).then((r) => r.json())
      .catch((e) => ({ error: e.name === "AbortError" ? "Kiểm tra quá thời gian. Bấm Kiểm tra lại." : "Mất kết nối với app. Bấm Kiểm tra lại." }));
    clearTimeout(timer);
    const steps = [].concat(report.Steps || []);
    if (!steps.length) for (const row of items.values()) { row.mark.textContent = "!"; row.mark.style.color = marks.warn[1]; row.detail.textContent = report.error || "Chưa kiểm tra được. Bấm Kiểm tra lại."; }
    for (const step of steps) {
      const row = items.get(step.Id) || item(step.Id, $("#base"));
      if (!NAMES[step.Id]) row.name.textContent = step.Title;
      const [mark, color] = marks[step.State] || ["○", ""];
      row.mark.textContent = mark; row.mark.style.color = color;
      row.detail.textContent = step.Detail || "";
      row.uses.textContent = step.Uses ? `Dùng cho: ${step.Uses}` : "";
      if (step.Action) {
        const signedIn = step.State === "ok";
        row.fix.textContent = signedIn && step.Action === "login" ? "Đổi tài khoản" : LABELS[step.Action] || "Mở";
        row.fix.classList.toggle("primary", !signedIn);
        row.fix.hidden = false;
        row.fix.onclick = () => fix(step, row);
      }
    }
    $(".again").disabled = false;
    checking = false;
  };

  // While Codex signs in: the one-time code to type on the page opened in Chrome, with Chép mã.
  let watching = 0;
  const watchLogin = () => {
    if (watching) return;
    watching = setInterval(async () => {
      const { code } = await fetch("/api/setup-login").then((r) => r.json()).catch(() => ({}));
      const detail = items.get("login").detail;
      if (!code) { if (detail.dataset.code) { delete detail.dataset.code; } return; }
      if (detail.dataset.code === code && detail.querySelector(".copy-code")) return;
      detail.dataset.code = code;
      const copy = el("button", "copy-code", "Chép mã");
      copy.type = "button";
      copy.onclick = async () => {
        // The clipboard API needs a focused page; the old copy command covers the rest.
        const done = await navigator.clipboard.writeText(code).then(() => true, () => {
          const box = Object.assign(document.createElement("textarea"), { value: code });
          document.body.append(box); box.select();
          const ok = document.execCommand("copy");
          box.remove();
          return ok;
        });
        copy.textContent = done ? "Đã chép" : "Chưa chép được";
        setTimeout(() => { copy.textContent = "Chép mã"; }, 2000);
      };
      detail.replaceChildren(`Mã đăng nhập: ${code} `, copy, ". Dán vào trang đăng nhập vừa mở trong Chrome (đăng nhập tài khoản ChatGPT muốn dùng). Lỗi thì bấm lại để lấy mã mới.");
      for (const b of buttons()) b.disabled = false;
    }, 1000);
  };

  // Installing, opening Chrome or signing in runs on this computer; the steps are checked again after.
  const buttons = () => [...document.querySelectorAll(".item .side .btn")];
  const fix = async (step, row) => {
    for (const b of buttons()) b.disabled = true;
    row.detail.textContent = WAIT[step.Action] || "Đang mở…";
    if (step.Action === "login") watchLogin();
    const r = await post("/api/setup-step", { step: step.Action });
    if (r.superseded) return;
    for (const b of buttons()) b.disabled = false;
    await check();
    if (r.error) row.detail.textContent = r.error;
  };
  $(".again").onclick = check;

  check();
})();
