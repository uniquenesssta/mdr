/**
 * Responsibility: Public Theme Service facade for applying committed Settings theme state to the application theme root.
 * Imports: Theme implementation only.
 * Exports: createThemeService().
 * State/side effects: Import-only facade; no DOM mutation, persistence or listener registration at import time.
 */
export { createThemeService } from './theme-service.js';
export { createThemeToggleController } from './theme-toggle-controller.js';
