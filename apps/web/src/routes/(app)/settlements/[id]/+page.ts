// Dynamic settlement detail: set at runtime from client navigation with a
// parametered URL, so it cannot be prerendered at build time (no static links
// to crawl). It stays a serverless-rendered shell; offline navigation to it is
// served by the service worker's navigateFallback '/' shell (PRD §9.2).
export const prerender = false;
