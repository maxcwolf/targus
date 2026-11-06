// Architecture guard for docs/engineering-standards.md section 1.2. `yarn depcruise` (part of
// `yarn check`) fails on any violation. Loosening a rule needs a maintainer review (CODEOWNERS)
// and an ADR.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      comment: 'No import cycles anywhere.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'core-no-node-builtins',
      comment: 'packages/core is pure: no Node builtins (node:fs, node:crypto, ...).',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'core-dependency-allowlist',
      comment:
        'packages/core may depend only on zod (contracts) and on pixelmatch and pngjs, which back ' +
        'diffImages (ADR 0003): pure computation on bytes, nothing that touches the OS or network. ' +
        'Adding another library to core (ws, ...) means extending this allowlist in a reviewed PR.',
      severity: 'error',
      from: { path: '^packages/core/src/', pathNot: '\\.test\\.ts$' },
      to: {
        path: 'node_modules/',
        pathNot: ['node_modules/zod/', 'node_modules/pixelmatch/', 'node_modules/pngjs/'],
      },
    },
    {
      name: 'core-no-other-workspaces',
      comment: 'core depends on nothing else in the repo: not apps/*, packages/cli or any package.',
      severity: 'error',
      from: { path: '^packages/core/' },
      to: { path: '^(apps|packages|e2e|scripts)/', pathNot: '^packages/core/' },
    },
    {
      name: 'no-importing-apps',
      comment: 'Nothing depends on an app; apps do not depend on each other.',
      severity: 'error',
      from: { pathNot: '^apps/' },
      to: { path: '^apps/' },
    },
    {
      name: 'apps-do-not-import-each-other',
      severity: 'error',
      from: { path: '^apps/([^/]+)/' },
      to: { path: '^apps/', pathNot: '^apps/$1/' },
    },
    {
      name: 'only-public-package-entry',
      comment:
        'A workspace reaches another only through its src/index.ts (the `exports` entry), never ' +
        'into its internals.',
      severity: 'error',
      from: { path: '^((?:packages|apps)/[^/]+)/' },
      to: {
        path: '^(?:packages|apps)/[^/]+/',
        pathNot: ['^$1/', '^(?:packages|apps)/[^/]+/src/index\\.ts$'],
      },
    },
    {
      name: 'api-routes-not-repositories',
      comment: 'Routes call one service; only services touch repositories and storage.',
      severity: 'error',
      from: { path: '^apps/api/src/routes/' },
      to: { path: '^apps/api/src/(repositories|storage|db)/' },
    },
    {
      name: 'api-layers-point-down',
      comment: 'repositories/ and storage/ are adapters: they never call services or routes.',
      severity: 'error',
      from: { path: '^apps/api/src/(repositories|storage|services)/' },
      to: { path: '^apps/api/src/routes/' },
    },
    {
      name: 'api-adapters-not-services',
      severity: 'error',
      from: { path: '^apps/api/src/(repositories|storage)/' },
      to: { path: '^apps/api/src/services/' },
    },
    {
      name: 'web-features-use-api-client-index',
      comment:
        'Data enters the web app only through api-client/. Features import its index.ts; the fetch ' +
        'helper behind it (http.ts) is private to api-client/. The `fetch` global itself is banned ' +
        'outside api-client/ by ESLint no-restricted-globals, which dependency-cruiser cannot see.',
      severity: 'error',
      from: { path: '^apps/web/src/', pathNot: '^apps/web/src/api-client/' },
      to: { path: '^apps/web/src/api-client/', pathNot: '^apps/web/src/api-client/index\\.ts$' },
    },
    {
      name: 'web-components-are-presentational',
      comment: 'Shared components under components/ receive data as props; they never load it.',
      severity: 'error',
      from: { path: '^apps/web/src/components/' },
      to: { path: '^apps/web/src/(api-client|features)/' },
    },
    {
      name: 'web-features-through-index',
      comment:
        "A feature reaches another feature only through that feature's index.ts, never into its " +
        'files (ADR 0019). Files inside one feature import each other directly.',
      severity: 'error',
      from: { path: '^apps/web/src/features/([^/]+)/' },
      to: {
        path: '^apps/web/src/features/',
        pathNot: ['^apps/web/src/features/$1/', '^apps/web/src/features/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'web-app-uses-feature-index',
      comment:
        'Outside features/ (app/, main.tsx, test/), a feature is reached only through its ' +
        'index.ts (ADR 0019).',
      severity: 'error',
      from: { path: '^apps/web/src/', pathNot: '^apps/web/src/features/' },
      to: { path: '^apps/web/src/features/', pathNot: '^apps/web/src/features/[^/]+/index\\.ts$' },
    },
    {
      name: 'web-feature-index-exports-own-files',
      comment:
        'A feature index.ts re-exports only files of its own feature, so it never becomes a hub ' +
        'that ties other features together (ADR 0019).',
      severity: 'error',
      from: { path: '^apps/web/src/features/([^/]+)/index\\.ts$' },
      to: { path: '^apps/web/src/', pathNot: '^apps/web/src/features/$1/' },
    },
    {
      name: 'no-test-code-in-production',
      comment: 'Production modules never import tests or test helpers.',
      severity: 'error',
      from: { path: '\\.(?:ts|tsx|mjs)$', pathNot: ['\\.test\\.(?:ts|tsx|mjs)$', '/test/'] },
      to: { path: ['\\.test\\.(?:ts|tsx|mjs)$', '^apps/[^/]+/(?:src/)?test/'] },
    },
    {
      name: 'not-to-unresolvable',
      comment: 'Every import resolves (catches typos and undeclared packages).',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'not-to-dev-dep',
      comment: 'Shipped package code may not import devDependencies.',
      severity: 'error',
      from: {
        path: '^packages/[^/]+/src/',
        pathNot: ['\\.test\\.(?:ts|tsx)$', '\\.fake\\.ts$'],
      },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only', 'npm-peer'] },
    },
  ],
  options: {
    doNotFollow: { path: ['node_modules'] },
    exclude: {
      path: '^(?:packages|apps)/[^/]+/(?:dist|\\.tsbuild|coverage|\\.wrangler)/|^e2e/(?:\\.tsbuild|test-results|playwright-report)/',
    },
    tsPreCompilationDeps: true,
    combinedDependencies: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      // "development" maps workspace packages to src/index.ts (ADR 0010). Without it they resolve
      // to dist/, which is excluded above, and every cross-workspace edge silently disappears.
      conditionNames: ['development', 'import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings'],
      extensions: ['.ts', '.tsx', '.d.ts', '.js', '.mjs', '.cjs', '.json'],
    },
    builtInModules: { add: ['cloudflare:workers', 'cloudflare:test'] },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
