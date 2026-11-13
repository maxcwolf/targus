import type { CreateProjectResponse } from '@targus/core/browser';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';

/** The new project and its token. The token is not stored readable anywhere, so this is it. */
export function TokenPanel({ created }: { created: CreateProjectResponse }): ReactElement {
  const { project, token } = created;
  const origin = globalThis.location.origin;
  return (
    <section className="onboarding">
      <h1 className="page-title">{project.name} is ready</h1>
      <div className="card onboarding-step">
        <h2>Project token</h2>
        <p className="notice">
          Copy it now: it is shown only this once. Store it as the secret <code>TARGUS_TOKEN</code>{' '}
          in your CI.
        </p>
        <pre className="token" aria-label="Project token">
          {token}
        </pre>
      </div>
      <div className="card onboarding-step">
        <h2>Send the first build</h2>
        <p className="muted">
          In a checkout of <span className="mono">{project.repo}</span>, after{' '}
          <span className="mono">targus capture</span> has written{' '}
          <span className="mono">visual/current</span>:
        </p>
        <pre className="snippet">
          {`export TARGUS_API_URL=${origin}\nexport TARGUS_TOKEN=<the token above>\nnpx targus run --from-capture visual/current`}
        </pre>
        <p className="muted">
          Builds of <span className="mono">{project.defaultBranch}</span> become the baselines that
          pull requests are compared with.
        </p>
        <Link
          to="/projects/$projectId"
          params={{ projectId: project.id }}
          className="button primary"
        >
          Open the project
        </Link>
      </div>
    </section>
  );
}
