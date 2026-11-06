# Changesets

Every change that should ship in a release adds one changeset: run `npx changeset`, pick the bump, and write one line for the changelog. **Actions → Release adapter → Run workflow** turns the pending changesets into the next version, runs every check, tags `vX.Y.Z` and publishes to npm with provenance.
