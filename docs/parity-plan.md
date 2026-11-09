# Closing the gaps with Chromatic

Status: plan, written 2026-11-09. Nothing on this page is built unless it says so; N1 is.

targus has two jobs. On native it does what no hosted service does: visual review of the
on-device Storybook. On the web it aims to replace Chromatic once it matches what a team uses
from it. This page orders the work for both, and for the parts they share. The feature-by-feature
table is in [web-plan.md section 8](web-plan.md#8-toward-chromatic-parity); this page says what
comes next and why.

The order follows what the pilot app uses from Chromatic today, read from its stories and its
workflow on 2026-11-09:

- **Modes**: a font-scale global ("max font scale") on many stories, and a desktop viewport on a
  few.
- **`disable`** on a few stories.
- **Play functions** in nine story files.
- **`onlyChanged`** (TurboSnap) in the workflow.
- Not used: ignore regions, per-story thresholds, other browsers.

## Native

| #   | Item                                                          | Why it is here                                                                    |
| --- | ------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| N1  | Capture at a system font scale (built; below)                 | The mode the pilot app uses most on the web had no native equivalent              |
| N2  | Dark mode and a second device size as modes                   | Appearance is per build today (ADR 0035), not per story                           |
| N3  | First real CircleCI run, with run time on a full story set    | The recipe has only run on GitHub Actions; the time decides whether N5 is needed  |
| N4  | Baselines partitioned by device and iOS runtime               | A new runner image shows every story as changed today (plan.md section 6)         |
| N5  | Shards across simulators, or changed-stories-only             | Only if N3 shows the run is too slow                                              |
| N6  | Android                                                       | Large; after iOS is trusted                                                       |

### N1. Capture at a system font scale

Built (ADR [0042](adr/0042-content-sizes-on-a-device.md)). A story is captured with the
simulator's own accessibility text size changed, so the screenshot shows what a user with larger
text sees: the system setting, not a mocked scale inside the app.

- **How a story asks for it.** `parameters.targus.contentSizes` is a list of short size names,
  `xs` to `xxxl` and `ax1` to `ax5`
  ([story parameters](reference/story-parameters.md#content-sizes)). A story without it is
  captured once at the default size (`l`), which the CLI pins as it pins light mode.
- **How the size is set.** `xcrun simctl ui <udid> content_size <category>`, the same setting as
  Settings > Accessibility > Larger Text. It persists across reboots, so the CLI sets it on every
  run and never assumes it.
- **How a run captures it.** The spike showed that a running React Native app lays out again
  within a fraction of a second when the setting changes, with no relaunch. So a story is
  captured at the default size, then at each size it lists while it is still on screen, and the
  size is put back before the next story.
- **What a snapshot is.** Each size is its own snapshot with its own baseline, named
  `<story id>@<size>`, for example `button--primary@ax5`.

Still to do:

- A full `targus run` with sized captures published and reviewed, on the CI runner as well as
  locally.
- Whether an app that caps `maxFontSizeMultiplier` shows in the capture as it does on a phone.
- **Reading Chromatic's modes.** A web story's `parameters.chromatic.modes` sets Storybook
  globals, and a global named for font scale means whatever the project's decorator makes of
  it. targus does not guess: a project would map a global's values to content sizes in
  `targus.config.ts`, or set `contentSizes` on the story. The mapping is not built.

## Web

| #   | Item                                                                    | Why it is here                                                                  |
| --- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| W1  | A web job in the proof of concept's CI, then on the pilot app in shadow | Nothing below can be judged until web builds run on real pull requests          |
| W2  | Check modes and play functions against the pilot app's own stories      | Both are built or designed for, and proven only on the proof of concept         |
| W3  | Measure a full run, then choose: parallel pages or changed-stories-only | `onlyChanged` saves Chromatic's snapshot cost; targus needs it only if slow     |
| W4  | A published Storybook per build, linked from the review                 | Reviewers lose the hosted Storybook when Chromatic goes                         |
| W5  | Per-story threshold, ignore regions, pause at the end of an animation   | Not used by the pilot app; cheap to have before a switch                        |
| W6  | Other browsers, review comments, Slack                                  | Only when a team asks                                                           |

"In shadow" means beside Chromatic, with `targus/web` visible on pull requests and not required.
The switch is a decision for after W1 to W4, when the two have agreed on real pull requests.

## Shared

| #   | Item                                                             | Why it is here                                                       |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| S1  | A project is created when the GitHub App is installed            | Today an admin call creates it                                       |
| S2  | Rename "check run" in the code, the contract and the CLI output  | The check is a commit status since ADR 0040                          |
| S3  | Run on a container host with Postgres and S3                     | For a team that hosts it itself; see [hosting-portability.md](hosting-portability.md) |

## What comes first

N1 is built. W1 is next, because it unblocks every decision about the web; on native, N2 and N3
follow.
