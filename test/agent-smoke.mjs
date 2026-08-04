// Gate: proves the Agent SDK spawns, auths via Pete's existing Claude Code login,
// and yields the message shapes main.js depends on. Run: npm run smoke:agent
import { query } from "@anthropic-ai/claude-agent-sdk";
import os from "node:os";

const timeout = setTimeout(() => {
  console.error("SMOKE FAIL: timed out after 120s");
  process.exit(1);
}, 120_000);

let sessionId = null;
let apiKeySource = null;
let resultText = null;

try {
  const q = query({
    prompt: "Reply with exactly: CLAWD-OK",
    options: {
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      settingSources: [],
      cwd: os.homedir(),
      maxTurns: 1,
      env: {
        ...process.env,
        PATH: `${process.env.PATH}:/opt/homebrew/bin:/usr/local/bin`,
      },
    },
  });
  for await (const msg of q) {
    if (msg.type === "system" && msg.subtype === "init") {
      sessionId = msg.session_id;
      apiKeySource = msg.apiKeySource;
    } else if (msg.type === "result") {
      resultText = msg.subtype === "success" ? msg.result : `ERROR(${msg.subtype})`;
    }
  }
} catch (e) {
  console.error("SMOKE FAIL:", e?.message || e);
  process.exit(1);
}

clearTimeout(timeout);
console.log("session_id:", sessionId);
console.log("apiKeySource:", apiKeySource);
console.log("result:", resultText);
if (!sessionId || !resultText || !resultText.includes("CLAWD-OK")) {
  console.error("SMOKE FAIL: unexpected output");
  process.exit(1);
}
console.log("SMOKE PASS");
