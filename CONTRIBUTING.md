# Contributing

Run `npm ci`, then `npm run typecheck`, `npm test` and `npm run build`. CI runs the same checks on Node 22 and 24.

## Releasing

1. Each PR that should ship adds a changeset (`npx changeset`).
2. Run **Actions → Release adapter → Run workflow** from `main`. It applies the changesets, runs every check, pushes the version bump with a `vX.Y.Z` tag, and publishes the tarball to npm with provenance from the `npm-release` environment.
3. After a release, update the pinned README link (`…/tree/vX.Y.Z`) in the Chat SDK catalog entry and on `www.tryadeli.com/docs/chat-sdk`, whenever env vars, peer dependencies or the factory change.

Dependencies must be published versions. The release refuses `file:`, `link:` and git dependencies.
