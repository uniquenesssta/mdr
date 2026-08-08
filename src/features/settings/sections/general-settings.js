/**
 * Responsibility: Describe the immutable General Settings field order, control semantics and current exposure surface.
 * Imports: Settings section contract plus domain section ids only.
 * Exports: GENERAL_SETTINGS_SECTION.
 * State/side effects: Import-only immutable descriptor; no DOM, storage or business-module calls.
 */
import { SETTING_SECTIONS } from '../domain/settings-schema.js';
import { defineSettingsSection } from './settings-section.js';

export const GENERAL_SETTINGS_SECTION = defineSettingsSection({
  id: SETTING_SECTIONS.GENERAL,
  fields: [
    { settingId: 'theme', control: 'select', surface: 'settings-dialog' },
    { settingId: 'language', control: 'select', surface: 'settings-dialog' },
    { settingId: 'layoutMode', control: 'select', surface: 'settings-dialog' },
    { settingId: 'sidebarVisible', control: 'toggle', surface: 'settings-dialog' }
  ]
});
