export const ssr = false;
// Prerender all route shells (empty HTML documents under ssr = false) so the
// service worker precache includes every URL's HTML and cold offline launches
// on any route succeed (PRD §9.2). No +page.server.ts or form actions exist.
export const prerender = true;
