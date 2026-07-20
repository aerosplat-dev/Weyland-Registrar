import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveExtensionBasePath } from '../lib/location.js';

test('resolves base path for a third-party (nested-repo) install', () => {
    const metaUrl = 'http://localhost:8000/scripts/extensions/third-party/Weyland-Registrar/lib/location.js';
    assert.equal(resolveExtensionBasePath(metaUrl), 'third-party/Weyland-Registrar');
});

test('resolves base path for a bundled install', () => {
    const metaUrl = 'http://localhost:8000/scripts/extensions/Weyland-Registrar/lib/location.js';
    assert.equal(resolveExtensionBasePath(metaUrl), 'Weyland-Registrar');
});

test('resolves base path for a nested module (lib/ui/toolbarButton.js)', () => {
    const metaUrl = 'http://localhost:8000/scripts/extensions/third-party/Weyland-Registrar/lib/ui/toolbarButton.js';
    assert.equal(resolveExtensionBasePath(metaUrl), 'third-party/Weyland-Registrar');
});
