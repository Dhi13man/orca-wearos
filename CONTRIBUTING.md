# Contributing

Keep changes focused on the direct Wear companion. Open an issue before
changing pairing, reply authorization, wire behavior, or the package identity.

1. Fork the repository and work on a focused branch.
2. From `wearos/`, install with `pnpm install --frozen-lockfile`, then run
   `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and `pnpm test`.
3. For Android changes, run the release build documented in [README.md](README.md).
4. Open a pull request with the behavior changed and the checks you ran.

Do not commit pairing links, device tokens, keystores, `google-services.json`,
runtime data, or generated APKs. Tests should use disposable hosts and sessions;
never send a test prompt to someone else's active agent.

Contributions are licensed under [MIT](LICENSE). Follow the
[code of conduct](CODE_OF_CONDUCT.md).
