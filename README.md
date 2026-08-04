# Clawd 🧡

A pixel Claude critter that lives on your desktop — and actually does your tasks.

Clawd is a frameless, transparent, always-on-top Electron pet backed by the
**Claude Agent SDK** (the Claude Code engine as a library). It uses your existing
Claude Code login (Keychain OAuth), runs with full autonomy
(`bypassPermissions`), and has real tools: Bash, Read/Write/Edit, Glob/Grep,
WebSearch/WebFetch. The sprite is 100% procedural pixel art — no image assets.

Personal tool: Anthropic's terms don't allow shipping subscription-auth agents
to third parties. Don't distribute.

## Controls

| Action | How |
|---|---|
| Open/close chat | Click the pet (or the status pill), or ⌥⇧C |
| Move the pet | Drag it |
| Menu (Sounds on/off · New Conversation / Quit) | Right-click the pet |
| Send | Enter (Shift+Enter = newline) |
| Stop a running task | ■ button while busy |

The pet animates off real agent state: spins while thinking, pulses while
running tools, flaps its mouth while replying, sleeps after 90 s idle.
The status pill shows the live action (like "Running: git status…").

## Dev

```bash
npm install
npm run smoke:agent   # SDK + auth gate (one tiny real turn)
npm start             # run the pet
npm run smoke         # boot + screenshot + exit (CI-ish)
```

`electron . '--probe=<task>'` drives one real end-to-end turn headlessly and
writes a screenshot (add `--smoke-out=/path.png`).

## Package

```bash
npm run package       # → dist/Clawd-darwin-arm64/Clawd.app
cp -R dist/Clawd-darwin-arm64/Clawd.app /Applications/
open /Applications/Clawd.app
```

First packaged launch registers Clawd as a **login item** (System Settings →
General → Login Items; remove it there to opt out). No dock icon by design —
quit via right-click → Quit Clawd, or `pkill -f Clawd.app`.

## Sharing with coworkers

Clawd carries **no credentials** — it resolves whoever-is-running-it's Claude
auth at launch. So sharing = share the code, and each person brings their own
auth:

1. **They have Claude Code installed & logged in** → Clawd just works.
2. **Or** they export `ANTHROPIC_API_KEY` (org console key) in their shell /
   launchd env — the SDK prefers it over OAuth automatically.

Recommended path — share the repo, everyone builds locally:

```bash
git clone <repo-url> clawd && cd clawd
npm install          # needs Node 18+
npm run smoke:agent  # verifies their auth in 30s
npm run package && cp -R dist/Clawd-darwin-arm64/Clawd.app /Applications/
open /Applications/Clawd.app
```

Why not just AirDrop the .app? It's unsigned — a *downloaded* copy gets
quarantined and Gatekeeper refuses it (locally built copies are fine). Fixing
that properly means an Apple Developer ID + notarization (plus re-signing the
SDK's bundled `claude` binary). Intel Macs: build with `--arch=x64` in the
package script.

Per Anthropic's Agent SDK terms, don't distribute a product on claude.ai
subscription login — internal colleagues using their own logins/keys on their
own machines is the pattern above; anything bigger should be API-key auth.

## Troubleshooting

- **"Operation not permitted" on Desktop/Documents/Downloads** — macOS folder
  protection. Grant Clawd access in System Settings → Privacy & Security →
  Files and Folders (or Full Disk Access). The agent's Write/Read tools may
  work before the shell does; the prompt appears on first shell touch.
- **Keychain prompt on first packaged launch** — the bundled `claude` binary
  reading your Claude Code credentials. Click "Always Allow".
- **Agent errors immediately** — check `claude` login still valid (`claude`
  in a terminal) and that the session file isn't stale: right-click → New
  Conversation.
- **Conversation memory** — persists across restarts (`~/Library/Application
  Support/clawd/session.json`); New Conversation clears it.
