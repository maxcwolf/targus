# 0018. Squash merges only, so every commit on main is a Conventional Commit

## Status

accepted

## Date

2026-11-06

## Context

Commit messages in this repo are Conventional Commits. commitlint checks each one in the
`commit-msg` hook, and the `pr-title` CI job checks every pull request title, because a squash
merge uses the title as the commit subject.

The repository nevertheless allowed all three GitHub merge methods, and pull requests 1 to 17
were merged with merge commits. Their subjects ("Merge pull request #N from …") are not
Conventional Commits, and neither are the "Merge branch 'main' into …" commits made when a
branch was brought up to date. commitlint ignores merge commits, so nothing flagged them. The
history on `main` therefore did not follow the rule the rest of the tooling assumes.

## Decision

We will merge pull requests by squashing only.

- The repository's GitHub settings allow squash merges and switch off merge commits and rebase
  merges.
- The squash commit's subject is the PR title (`squash_merge_commit_title: PR_TITLE`), which
  the `pr-title` job has checked. Its body is the PR's commit messages.

So each pull request lands on `main` as one commit with a checked Conventional Commit subject,
and history on `main` is linear.

The 17 merge commits already on `main` were replaced the same day by one commit per pull
request, in the same order, each with exactly the file tree `main` had after that merge and the
pull request's title and number as its subject. The pull requests' own commits are listed in
each commit's body and remain on the pull request pages.

## Consequences

### Positive

- Every new commit on `main` follows the convention, and the check that guarantees it
  (`pr-title`) already exists.
- "Merge branch 'main' into …" commits inside a branch never reach `main`.
- One commit per change makes `git log`, `git revert` and a future changelog simpler.

### Negative

- The individual commits of a pull request are not kept on `main`; their messages are in the
  squash commit's body and the commits stay visible on the pull request.
- A branch stacked on another must be brought up to date after its base is squashed, because
  the base's commits no longer exist on `main` under the same hashes.
- The rule is a repository setting, not a file, so a change to it does not show up in a diff.
  Branch protection (engineering-standards.md 6.3) would add "require linear history" as a
  second guard.

## Alternatives considered

- **Merge commits with a Conventional Commit subject.** Possible by hand, but GitHub's default
  subject is not one, and nothing checks what the person merging types.
- **Rebase merges.** They keep each commit, but only the local `commit-msg` hook checks those
  messages, and it can be skipped; CI checks the PR title, not every commit.
