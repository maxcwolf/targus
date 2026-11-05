import type { Bindings } from './bindings.js';
import type { Project, Services } from './services/index.js';

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
