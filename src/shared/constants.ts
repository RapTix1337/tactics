// Zod-free so the renderer and preload can import it by subpath without
// bundling the schemas the barrel pulls in (validation is main-only,
// ADR-022; E5.1 watch item).
export const APP_NAME = 'TactiCS';
