/**
 * Responsibility: Describe immutable Save Settings fields for autosave enablement/delay and the default export directory.
 * Imports: Settings section contract plus domain section ids only.
 * Exports: SAVE_SETTINGS_SECTION.
 * State/side effects: Import-only immutable descriptor; no DOM, storage, export or business-module calls.
  * Lifecycle: Import-only immutable section descriptor; no runtime lifecycle.
 */
import { SETTING_SECTIONS } from '../domain/settings-schema.js';
import { defineSettingsSection } from './settings-section.js';

export const SAVE_SETTINGS_SECTION = defineSettingsSection({
  id: SETTING_SECTIONS.SAVE,
  fields: [
    { settingId: 'autoSaveEnabled', control: 'toggle', surface: 'settings-dialog' },
    { settingId: 'autoSaveDelay', control: 'duration', surface: 'settings-dialog' },
    { settingId: 'exportDirectory', control: 'directory', surface: 'settings-dialog' }
  ]
});
