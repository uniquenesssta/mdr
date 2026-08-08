/**
 * Responsibility: Describe immutable Editor Settings fields while preserving external ownership of visual-editing menu toggles.
 * Imports: Settings section contract plus domain section ids only.
 * Exports: EDITOR_SETTINGS_SECTION.
 * State/side effects: Import-only immutable descriptor; no DOM, storage, editor or business-module calls.
 */
import { SETTING_SECTIONS } from '../domain/settings-schema.js';
import { defineSettingsSection } from './settings-section.js';

export const EDITOR_SETTINGS_SECTION = defineSettingsSection({
  id: SETTING_SECTIONS.EDITOR,
  fields: [
    { settingId: 'editorFontSize', control: 'select', surface: 'settings-dialog' },
    { settingId: 'editorTextColor', control: 'color', surface: 'settings-dialog' },
    { settingId: 'activeLineColor', control: 'color', surface: 'settings-dialog' },
    { settingId: 'tableVisualEditing', control: 'toggle', surface: 'external' },
    { settingId: 'codeVisualEditing', control: 'toggle', surface: 'external' }
  ]
});
