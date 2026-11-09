// One-off: moves every draft's status.json (workspace/drafts/<brand>/<id>/) to the current status set. The approval
// step is gone (user, 09/11/2026), so an old status from that flow (awaiting_approval, or anything unknown) becomes:
// written into the brand (status has brand_post) -> "approved"; otherwise "ready" (finalize.mjs checks it again before
// writing). Each changed file is backed up first to workspace/trash/status-backup-<date>/<brand>/<id>/status.json;
// migrated_from records the old value. Safe to run again (nothing left to change).
// node scripts/migrate-status.mjs [--dry]
import fs from 'node:fs';
import path from 'node:path';
import { main, out, isMain, parseArgs, readJson, writeJson, withLock, workspace, draftsRoot, today, stamp } from './lib.mjs';

export const CURRENT = ['preparing', 'needs_prompt', 'generating', 'needs_caption', 'ready', 'check_failed', 'image_failed', 'approved', 'rejected'];
// Keys only the old approval flow wrote into status.json.
const LEGACY_KEYS = ['approval', 'approved_by', 'awaiting_approval', 'review'];

export const nextStatus = (st) => (CURRENT.includes(st.status) ? st.status : st.brand_post ? 'approved' : 'ready');

export function migrate({ dry = false } = {}) {
  const changes = [];
  if (!fs.existsSync(draftsRoot)) return { changes };
  const backup = path.join(workspace, 'trash', `status-backup-${today()}`);
  for (const brand of fs.readdirSync(draftsRoot)) {
    const bdir = path.join(draftsRoot, brand);
    if (!fs.statSync(bdir).isDirectory()) continue;
    for (const id of fs.readdirSync(bdir)) {
      const file = path.join(bdir, id, 'status.json');
      if (!fs.existsSync(file)) continue;
      withLock(file, () => {
        const st = readJson(file);
        const to = nextStatus(st);
        const legacy = LEGACY_KEYS.filter((k) => k in st);
        if (to === st.status && !legacy.length) return;
        changes.push({ id, from: st.status, to, dropped: legacy });
        if (dry) return;
        const bk = path.join(backup, brand, id, 'status.json');
        if (!fs.existsSync(bk)) { fs.mkdirSync(path.dirname(bk), { recursive: true }); fs.copyFileSync(file, bk); }
        const next = { ...st, status: to, tool_status: to, migrated_from: st.status, updated: stamp() };
        for (const k of legacy) delete next[k];
        writeJson(file, next);
      });
    }
  }
  return { dry, backup: changes.length && !dry ? backup : null, changes };
}

if (isMain(import.meta.url)) main(() => out(migrate({ dry: parseArgs().dry === true })));
