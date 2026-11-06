import type { Bindings } from './bindings.ts';
import type { Principal, Project, Reviewer, Services } from './services/index.ts';

/** Hono environment shared by every route: bindings plus the request's bound services. */
export interface AppEnv {
  Bindings: Bindings;
  Variables: { services: Services };
}

/** Routes behind `projectAuth`, which puts the authenticated project on the context. */
export interface ProjectEnv {
  Bindings: Bindings;
  Variables: { services: Services; project: Project };
}

/** Routes behind `sessionAuth`, which puts the signed-in reviewer on the context. */
export interface ReviewerEnv {
  Bindings: Bindings;
  Variables: { services: Services; reviewer: Reviewer };
}

/** Routes behind `readerAuth`: a project token or a session, whichever the request carries. */
export interface PrincipalEnv {
  Bindings: Bindings;
  Variables: { services: Services; principal: Principal };
}
