import type { Bindings } from './bindings.ts';
import type { RequestLog } from './logging/request-log.ts';
import type { Principal, Project, Reviewer, Services } from './services/index.ts';

/** What every request carries: its log (set first, by `requestLogger`) and its bound services. */
interface RequestVariables {
  log: RequestLog;
  services: Services;
}

/** Hono environment shared by every route: bindings plus the request's log and services. */
export interface AppEnv {
  Bindings: Bindings;
  Variables: RequestVariables;
}

/** Routes behind `projectAuth`, which puts the authenticated project on the context. */
export interface ProjectEnv {
  Bindings: Bindings;
  Variables: RequestVariables & { project: Project };
}

/** Routes behind `sessionAuth`, which puts the signed-in reviewer on the context. */
export interface ReviewerEnv {
  Bindings: Bindings;
  Variables: RequestVariables & { reviewer: Reviewer };
}

/** Routes behind `readerAuth`: a project token or a session, whichever the request carries. */
export interface PrincipalEnv {
  Bindings: Bindings;
  Variables: RequestVariables & { principal: Principal };
}
