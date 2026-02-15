# Frontend Local Build Helpers

- Double-click `dev-build.cmd` to run a production build.
- Double-click `dev-lint.cmd` to run lint checks.
- These wrappers set Node on `PATH` because some shells (including agents) do not inherit `PATH` reliably.
- Root launcher scripts use `C:\AI_WORKSPACE\ai-office\with-runtime.cmd` for the same PATH reliability on Windows.
