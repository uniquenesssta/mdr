/**
 * Responsibility: Describe the immutable Performance Settings field for large-document preview strategy selection.
 * Imports: Settings section contract plus domain section ids only.
 * Exports: PERFORMANCE_SETTINGS_SECTION.
 * State/side effects: Import-only immutable descriptor; no DOM, storage, preview or business-module calls.
 */
import { SETTING_SECTIONS } from '../domain/settings-schema.js';
import { defineSettingsSection } from './settings-section.js';

export const PERFORMANCE_SETTINGS_SECTION = defineSettingsSection({
  id: SETTING_SECTIONS.PERFORMANCE,
  fields: [
    { settingId: 'previewPerformanceMode', control: 'select', surface: 'settings-dialog' }
  ]
});
