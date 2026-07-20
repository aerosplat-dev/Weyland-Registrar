import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_NAME, defaultSettings, getSettings } from '../lib/settings.js';

test('creates default settings on first use', () => {
    const extensionSettings = {};
    const settings = getSettings(extensionSettings);
    assert.deepEqual(settings, defaultSettings);
    assert.equal(extensionSettings[MODULE_NAME], settings);
});

test('backfills newly-added keys without clobbering existing values', () => {
    const extensionSettings = {
        [MODULE_NAME]: { apiBaseUrl: 'https://custom.example.com' },
    };
    const settings = getSettings(extensionSettings);
    assert.equal(settings.apiBaseUrl, 'https://custom.example.com');
    assert.equal(settings.refreshIntervalMinutes, defaultSettings.refreshIntervalMinutes);
});

test('nested default objects are independent per extensionSettings instance', () => {
    const a = getSettings({});
    const b = getSettings({});
    a.itemStates['char:1'] = 'active';
    assert.equal(b.itemStates['char:1'], undefined);
});
