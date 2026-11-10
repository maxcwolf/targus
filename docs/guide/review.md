# Review changes

When a pull request changes how a story looks, its `targus/ios` check says how many changes
await review. Clicking the check on the pull request opens the build in the targus review UI. Each platform
reports its own check, named after it (`targus/ios`, and `targus/web` or `targus/android` once
those are captured), and has its own baselines; branch protection requires each one separately.

## Who can review

Sign in with GitHub. You can review a project's builds when you are a member of the GitHub
organization that owns the repository. For a repository on a personal account, its owner
reviews.

## The build page

The counters across the top are also filters: **Stories**, **Changes**, **Accepted**,
**Denied** and **Unreviewed**, with **New**, **Removed** and **Changed** under **More**. The page
opens on **Unreviewed**. The header shows the platform and device, the PR, the commit and the
baseline build the build was compared with.

**Approve all** approves every change still pending in the build. If someone else decides one of
them while it runs, their decision stands and the result says how many were left that way.

## The snapshot viewer

Open a story to compare it with its baseline:

- **1 up**: one image at a time; `s` switches between the new image and the baseline.
- **2 up**: baseline and new side by side.
- **Slider**: drag across the image to wipe from one to the other.
- **Diff**: highlights the changed pixels on top of the image (not available in Slider).
- **Fit** and **100%**: fit the images to the pane, or show them at the size they had on the
  device: each image is divided by the pixel ratio it was captured at, so a 3x iOS capture is shown
  at a third of its pixel width and height.

| Key       | Action                                   |
| --------- | ---------------------------------------- |
| `j` / `→` | next snapshot                            |
| `k` / `←` | previous snapshot                        |
| `a`       | approve                                  |
| `d`       | deny                                     |
| `1`       | 1 up                                     |
| `2`       | 2 up                                     |
| `3`       | toggle the diff                          |
| `s`       | in 1 up, switch between new and baseline |
| `Esc`     | back to the build                        |

In the **Unreviewed** filter, a decision moves straight on to the next snapshot that is still
pending, so `a`, `a`, `d`, `a` walks through a build.

Every decision updates the check at once:

| Build                                         | Check                                    |
| --------------------------------------------- | ---------------------------------------- |
| changes still pending                         | pending: "N changes awaiting review"     |
| every change approved                         | success: "All visual changes approved"   |
| nothing changed                               | success: "No visual changes"             |
| at least one change denied                    | failure: "N changes denied"              |
| at least one story threw while rendering      | failure: "N stories failed to render"    |

Denying is not final. Approve the story later, or push a fix: the next build is compared again.

## How baselines and approvals work

These rules decide what each build is compared with, and when you are asked to review:

1. **A pull request is compared with where it started.** Its baseline is the most recent
   accepted build on the commit where the branch left `main` (the merge base), or on the nearest
   commit before it that has one. Changes that landed on `main` after you branched do not show up
   in your review.
2. **Each approval is remembered as "this story went from image A to image B".** A later build on
   any branch with the same change for the same story is approved automatically, so re-pushing a
   PR or rebasing it does not ask for the same review twice.
3. **Merging accepts what was approved.** The build on `main` after the merge applies the PR's
   approvals and becomes the baseline for later pull requests. A change that reaches `main`
   without an approval stays pending there, so it still gets reviewed. This holds for a merge
   commit, a squash merge and a rebase merge alike ([below](#squash-and-rebase-merges)).
4. **A story that errors keeps its old baseline.** It fails the build until a later build renders
   it again.
5. **`removed` and `unstable` never block the check.** They are shown so you can notice a story
   that disappeared, or one that never held still.
6. **An unstable capture never becomes the baseline.** Nobody reviewed it, so the story keeps its
   previous accepted image. The next build that captures it stably compares against that image,
   and any difference is `changed` and reviewed as usual.

The comparison itself is pixel-based: a story is `unchanged` when less than 0.1% of its pixels
differ (the service's threshold), and `changed` otherwise.


## Squash and rebase merges

A squash merge or a rebase merge puts new commits on `main`, and git no longer connects them to
the pull request's commits. targus does not use that connection. The build of `main` after the
merge is compared with the previous build of `main`, so a story the pull request changed shows as
changed again, from the same image to the same image, and the approval given on the pull request
(rule 2) accepts it. Nobody reviews it twice, and the check on `main` is green.

After a rebase merge only the last of the new commits has a build; its baseline is found by
walking back along `main` to the nearest commit that has one.

A story is reviewed again on `main` in two cases, because the pair of images is no longer the one
that was approved:

- **The merged commit renders the story differently from the pull request's last build**, even
  by a few pixels. Stories that render the same way every time do not meet this
  ([prepare your app](prepare-your-app.md)).
- **`main` changed the same story while the pull request was open**, so the story goes from a
  different image than the one the reviewer saw. Updating the branch from `main` before merging
  has the pull request reviewed against the new image instead.

## When everything changed at once

If every story in a build shows as changed, something about the capture environment moved, not
your components: a new Xcode or iOS runtime, another simulator device, the other light or dark
mode (shown next to the device), or a font that failed to load. Check the CI runner image before
approving. If the new look is right, **Approve all**, and the next build on `main` becomes the new
baseline.
