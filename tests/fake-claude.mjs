// Stand-in for `claude` in tests: records its arguments and stdin in FAKE_CLAUDE_OUT, prints stream-json lines.
// FAKE_CLAUDE_BEHAVIOR: ok (default) | sleep (stays busy) | fail (exit 3) | secret (prints token-like text) | notloggedin | metricool | noconnect. Never calls an AI.
import fs from 'node:fs';
const args = process.argv.slice(2);
const stdin = fs.readFileSync(0, 'utf8');
if (process.env.FAKE_CLAUDE_OUT) {
  const cfgPath = args[args.indexOf('--mcp-config') + 1];
  fs.writeFileSync(process.env.FAKE_CLAUDE_OUT, JSON.stringify({ args, stdin, cfgPath, cfg: cfgPath && fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : null, profile: process.env.PLAYWRIGHT_MCP_PROFILE_DIR_NAME || '' }));
}
const out = (o) => console.log(JSON.stringify(o));
const behavior = process.env.FAKE_CLAUDE_BEHAVIOR || 'ok';
out({ type: 'system', subtype: 'init' });
out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Opening the first reference page' }, { type: 'tool_use', name: 'mcp__playwright__browser_navigate', input: { url: 'https://x.test/?token=SECRETVALUE' } }] } });
out({ type: 'user', message: { content: [{ type: 'tool_result', content: 'TOOLRESULT-SECRET' }] } });
if (behavior === 'secret') out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Bearer abc.def.ghi X-Collect-Token: zzz9 PLAYWRIGHT_MCP_EXTENSION_TOKEN=TOPSECRET ' + 'A'.repeat(80) }] } });
if (behavior === 'notloggedin') { out({ type: 'assistant', error: 'authentication_failed', message: { content: [{ type: 'text', text: 'Not logged in · Please run /login' }] } }); out({ type: 'result', subtype: 'success', is_error: true, num_turns: 1, result: 'Not logged in · Please run /login' }); process.exit(1); }
else if (behavior === 'metricool') { out({ type: 'result', subtype: 'success', is_error: true, num_turns: 3, result: 'The Metricool connector needs you to sign in again.' }); process.exit(1); }
else if (behavior === 'noconnect') { out({ type: 'result', subtype: 'success', is_error: false, num_turns: 9, result: 'Stopped: the browser did not connect after 3 minutes.' }); process.exit(0); }
else if (behavior === 'sleep' || behavior === 'secret') setInterval(() => {}, 1000);
else if (behavior === 'fail') { console.error('boom: failed with token=ERRSECRET'); process.exit(3); }
else { out({ type: 'result', subtype: 'success', is_error: false, num_turns: 2, result: 'All done' }); process.exit(0); }
