import type { RequestLog } from './logging/request-log.ts';
import type { Principal, Project, Reviewer, Services } from './services/index.ts';

// No `Bindings` here (ADR 0023): the app is built from plain dependencies, so nothing below
// `createApp` reads the host's environment.

/** What every request carries: its log (set first, by `requestLogger`) and its bound services. */
interface RequestVariables {
  log: RequestLog;
  services: Services;
}

/** Hono environment shared by every route: the request's log and services. */
export interface AppEnv {
  Variables: RequestVariables;
}

/** Routes behind `projectAuth`, which puts the authenticated project on the context. */
export interface ProjectEnv {
  Variables: RequestVariables & { project: Project };
}

/** Routes behind `sessionAuth`, which puts the signed-in reviewer on the context. */
export interface ReviewerEnv {
  Variables: RequestVariables & { reviewer: Reviewer };
}

/** Routes behind `readerAuth`: a project token or a session, whichever the request carries. */
export interface PrincipalEnv {
  Variables: RequestVariables & { principal: Principal };
}
