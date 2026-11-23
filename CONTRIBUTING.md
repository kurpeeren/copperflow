# Contributing

Thank you for helping. Issues and pull requests are welcome.

## Setup

```bash
npm install
npm test            # run the tests
npm run coverage    # tests with the 80% coverage gate
npm run test:perf   # speed tests (test/**/*.perf.ts), on their own and one file at a time
npm run typecheck
npm run build
```

## Guidelines

- Write a failing test first, then the change that makes it pass.
- Edits to circuit files must stay minimal: change only the spans you mean to change, and
  keep the rest of the file byte for byte.
- Locks are a promise to the human. No code path an agent can reach may change a locked part.
- Design rules in `skills/` are written in our own words and name their sources. Do not copy
  text from books, standards or projects without a compatible license.
- Keep pull requests focused on one change.

## Releasing

A version is published to npm by pushing its tag; `.github/workflows/release.yml` does the rest.

1. Set the new version in `package.json`, `src/version.ts`, `server.json` (twice), the Rev line of
   `site/public/index.html` and `site/public/connect.html`, and the two plugin manifests,
   `.claude-plugin/plugin.json` and `.antigravity-plugin/plugin.json`. Run `npm install` so
   `package-lock.json` follows. `test/version.test.ts` fails while any of them differs.
2. Commit, and push `main`. Wait for CI to pass.
3. Tag that commit and push the tag:

   ```bash
   git tag v0.3.1
   git push origin v0.3.1
   ```

The workflow checks that the tag matches the version, runs the type check and the tests, builds
and publishes. It needs no token: on npmjs.com the package's Settings list this repository and
`release.yml` under Trusted publishing. A version number can be published only once.

## License of contributions

By submitting a contribution you agree that it is licensed under the Apache License 2.0,
as described in section 5 of the [license](LICENSE).
