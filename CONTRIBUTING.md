# Contributing

Thank you for helping. Issues and pull requests are welcome.

## Setup

```bash
npm install
npm test            # run the tests
npm run coverage    # tests with the 80% coverage gate
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

## License of contributions

By submitting a contribution you agree that it is licensed under the Apache License 2.0,
as described in section 5 of the [license](LICENSE).
