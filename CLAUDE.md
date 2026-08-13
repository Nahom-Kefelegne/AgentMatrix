# CLAUDE.md

**Follow [AGENTS.md](./AGENTS.md). It is the single source of truth for this repo.**

This file exists only so Claude Code picks up the same rules as every other agent. `AGENTS.md` is
the one instruction filename Copilot CLI, Kimi Code, and Codex all discover natively — Claude
reads `CLAUDE.md`, so this points there rather than restating anything.

Do not add rules here. Add them to `AGENTS.md`, or the two will drift and agents will follow
different standards depending on which CLI they happen to be.

@./AGENTS.md
