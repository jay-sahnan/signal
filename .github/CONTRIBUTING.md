# Contributing to Signal

Thanks for wanting to help. This is a short guide — read it before opening a PR.

## Getting set up

See [`docs/setup.md`](../docs/setup.md) for the full local-dev walkthrough (~10 minutes with a Supabase + Anthropic account ready). The short version:

```bash
npm install
npm run setup     # interactive: prompts for keys, runs DB migrations
npm run dev
```

## Good first issues

Issues tagged [`good first issue`](../../labels/good%20first%20issue) are scoped so you can land a PR without reading the whole codebase.

Assignment is first-quality-PR-wins: if you open a PR that cleanly resolves an issue and passes review, it gets merged regardless of who commented first. If you claim an issue and don't open a draft within 7 days, we'll free it up for someone else.

## Submitting a change

1. Fork, create a feature branch off `main`.
2. For anything bigger than ~20 lines, open an issue first so we can align on direction before you write code.
3. Run `npm run lint && npm run typecheck && npm run test` locally — CI will check the same.
4. Open the PR against `main`. Fill in the template (what / why / how you tested).
5. Expect review within a few business days.

## AI-assisted PRs

Allowed and welcome — we build Signal with Claude and other AI tools ourselves. You're responsible for the code you submit regardless of how it was produced: read it, test it, and make sure it actually does what you think it does. PRs that look like they were pasted without review (broken imports, fabricated APIs, unrelated changes) will be closed like any other low-effort contribution.

## Reporting issues

- **Bugs**: use the [bug report template](../../issues/new?template=01_bug_report.yml). Include reproduction steps, expected vs. actual, OS, Node version.
- **Feature requests**: use the [feature request template](../../issues/new?template=02_feature_request.yml). Describe the problem you're trying to solve first — solutions second.
- **Security**: do **not** open a public issue. See [`SECURITY.md`](./SECURITY.md).

## Code style

- TypeScript strict mode.
- Prettier + ESLint run via `lint-staged` on pre-commit (Husky installs the hook on `npm install`).
- Follow the patterns already in the codebase; don't mix styles within a file.

## License

By contributing, you agree that your contributions are licensed under [AGPL-3.0](../LICENSE) to match the rest of the repository.
