# Changesets

Every user-facing change to a published package (`@targus/core`, `@targus/cli`,
`@targus/react-native`) needs a changeset. Run `yarn changeset`, pick the packages and the semver
bump, and commit the generated file with your change.

The apps (`@targus/api`, `@targus/web`) and `@targus/e2e` are private and ignored: they are
deployed, not published.
