// Features import data access from here only, never from the files behind it
// (.dependency-cruiser.cjs `web-features-use-api-client-index`).
export { getHealth } from './health.js';
