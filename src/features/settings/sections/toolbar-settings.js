/**
 * Responsibility: Describe immutable Toolbar Settings fields for toolbar visibility and hidden-item selection.
 * Imports: Settings section contract plus domain section ids only.
 * Exports: TOOLBAR_SETTINGS_SECTION.
 * State/side effects: Import-only immutable descriptor; no DOM, storage, toolbar or business-module calls.
 */
import { SETTING_SECTIONS } from '../domain/settings-schema.js';
import { defineSettingsSection } from './settings-section.js';

export const TOOLBAR_SETTINGS_SECTION = defineSettingsSection({
  id: SETTING_SECTIONS.TOOLBAR,
  fields: [
    { settingId: 'toolbarVisible', control: 'toggle', surface: 'settings-dialog' },
    { settingId: 'toolbarHiddenItems', control: 'checklist', surface: 'settings-dialog' }
  ]
});
