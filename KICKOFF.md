# Kickoff prompt for Claude Code

Open this folder in Claude Code (`claude`), make sure the superpowers plugin is installed, and paste:

```
/superpowers:subagent-driven-development docs/superpowers/plans/2026-11-19-raahi-now-phase1-api.md
```

Before it starts, have PostgreSQL 16 ready and export:

```
export TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/raahi_now_test
```

The run stops only for a merge or push, a destructive operation, a security-sensitive action, or a broken plan. Every decision it makes is listed under "Rulings I made" at the end.
