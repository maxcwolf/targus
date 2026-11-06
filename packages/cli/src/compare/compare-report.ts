import type { CaptureComparison } from './compare-captures.ts';

/** Paths in the report are relative to the report directory so it can be moved as a whole. */
export interface ReportPaths {
  readonly baseline: (file: string) => string;
  readonly current: (file: string) => string;
  readonly diff: (storyId: string) => string;
}

const ratio = (value: number): number => Number(value.toFixed(6));

/** `report.json`: every bucket with its stories, ratios rounded to 6 decimals. */
export function comparisonJson(comparison: CaptureComparison, paths: ReportPaths): unknown {
  return {
    threshold: comparison.threshold,
    counts: {
      changed: comparison.changed.length,
      new: comparison.new.length,
      removed: comparison.removed.length,
      unchanged: comparison.unchanged.length,
      unstable: comparison.unstable.length,
      errored: comparison.errored.length,
    },
    changed: comparison.changed.map((story) => ({
      id: story.id,
      ratio: ratio(story.ratio),
      baseline: paths.baseline(story.baselineFile),
      current: paths.current(story.currentFile),
      diff: story.diffPng === null ? null : paths.diff(story.id),
    })),
    new: comparison.new,
    removed: comparison.removed,
    unchanged: comparison.unchanged.map(({ id, ratio: value }) => ({ id, ratio: ratio(value) })),
    unstable: comparison.unstable.map(({ id, ratio: value }) => ({ id, ratio: ratio(value) })),
    errored: comparison.errored,
  };
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function image(label: string, src: string | null): string {
  const body =
    src === null
      ? '<p class="none">sizes differ: no diff image</p>'
      : `<a href="${escapeHtml(src)}"><img loading="lazy" src="${escapeHtml(src)}" alt="${label}"></a>`;
  return `<figure><figcaption>${label}</figcaption>${body}</figure>`;
}

function idList(title: string, ids: readonly string[]): string {
  if (ids.length === 0) return '';
  const items = ids.map((id) => `<li><code>${escapeHtml(id)}</code></li>`).join('');
  return `<details><summary>${escapeHtml(title)} (${ids.length})</summary><ul>${items}</ul></details>`;
}

const styles = `
body{font:14px/1.4 system-ui,sans-serif;margin:24px;color:#1b1b1f;background:#fff}
h1{font-size:20px}h2{font-size:15px;margin:24px 0 8px}code{font-size:13px}
.story{border-top:1px solid #ddd;padding:12px 0}
.row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
figure{margin:0}figcaption{color:#666;font-size:12px;margin-bottom:4px}
img{width:100%;border:1px solid #ddd}.none{color:#666}
@media (prefers-color-scheme:dark){body{background:#151518;color:#e8e8ec}.story{border-color:#333}img{border-color:#333}}
`;

/** A self-contained `report.html`: baseline | current | diff for every changed story. */
export function comparisonHtml(comparison: CaptureComparison, paths: ReportPaths): string {
  const changed = comparison.changed
    .map((story) => {
      const percent = (story.ratio * 100).toFixed(3);
      const images = [
        image('baseline', paths.baseline(story.baselineFile)),
        image('current', paths.current(story.currentFile)),
        image('diff', story.diffPng === null ? null : paths.diff(story.id)),
      ].join('');
      return `<section class="story"><h2><code>${escapeHtml(story.id)}</code> ${percent}% changed</h2><div class="row">${images}</div></section>`;
    })
    .join('\n');
  const ids = (stories: readonly { id: string }[]): string[] => stories.map(({ id }) => id);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>targus compare</title><style>${styles}</style></head><body>
<h1>targus compare</h1>
<p>${comparison.changed.length} changed, ${comparison.new.length} new, ${comparison.removed.length} removed, ${comparison.unchanged.length} unchanged, ${comparison.unstable.length} unstable, ${comparison.errored.length} errored (threshold ${comparison.threshold}).</p>
${idList('New', ids(comparison.new))}
${idList('Removed', ids(comparison.removed))}
${idList('Unstable', ids(comparison.unstable))}
${idList('Errored', ids(comparison.errored))}
${changed || '<p>No changed stories.</p>'}
</body></html>
`;
}
