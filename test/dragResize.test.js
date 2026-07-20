import test from 'node:test';
import assert from 'node:assert/strict';
import { clampPosition, isMobileLayout } from '../lib/ui/dragResize.js';

test('clampPosition leaves an on-screen position unchanged', () => {
    const result = clampPosition(200, 100, 760, 580, 1400, 900);
    assert.deepEqual(result, { left: 200, top: 100 });
});

test('clampPosition prevents dragging fully off the left edge', () => {
    // width=760, minVisible=120 -> left should never go below -(760-120) = -640
    const result = clampPosition(-900, 100, 760, 580, 1400, 900);
    assert.equal(result.left, -640);
});

test('clampPosition prevents dragging fully off the right edge', () => {
    // viewportWidth=1400, minVisible=120 -> left should never exceed 1400-120 = 1280
    const result = clampPosition(2000, 100, 760, 580, 1400, 900);
    assert.equal(result.left, 1280);
});

test('clampPosition never allows top to go negative', () => {
    const result = clampPosition(200, -500, 760, 580, 1400, 900);
    assert.equal(result.top, 0);
});

test('clampPosition prevents dragging the titlebar fully below the viewport', () => {
    // viewportHeight=900, minVisible clamped to 80 for vertical -> top should never exceed 900-80 = 820
    const result = clampPosition(200, 5000, 760, 580, 1400, 900);
    assert.equal(result.top, 820);
});

test('clampPosition respects a custom minVisible', () => {
    const result = clampPosition(-900, 100, 760, 580, 1400, 900, 200);
    assert.equal(result.left, -560); // -(760-200)
});

test('isMobileLayout returns true when the media query matches', () => {
    const fakeMatchMedia = (query) => {
        assert.equal(query, '(max-width: 700px), (pointer: coarse)');
        return { matches: true };
    };
    assert.equal(isMobileLayout(fakeMatchMedia), true);
});

test('isMobileLayout returns false when the media query does not match', () => {
    const fakeMatchMedia = () => ({ matches: false });
    assert.equal(isMobileLayout(fakeMatchMedia), false);
});
