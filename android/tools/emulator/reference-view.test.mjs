import {test} from 'node:test';
import assert from 'node:assert/strict';
import {measuredView, PARITY_SIZES} from './reference-view.mjs';

test('nominal sizes retain their measured body, including a different status bar', () => {
    for (const size of PARITY_SIZES) {
        const [width, height] = size.split('x').map(Number);
        for (const top of [24, 46]) {
            const view = {screenWidth: width, screenHeight: height, width, height: height - top - 24, dpr: 2};
            assert.equal(measuredView(size, view, {x: 0, y: top * 2}).webView.height, height - top - 24);
        }
    }
});

test('wrong nominal display, density and out-of-screen body are rejected', () => {
    const view = {screenWidth: 384, screenHeight: 832, width: 384, height: 784, dpr: 2};
    for (const delta of [{screenHeight: 810}, {screenWidth: 360}, {width: 360}, {dpr: 1}, {height: 832}, {height: NaN}]) {
        assert.throws(() => measuredView('384x832', {...view, ...delta}, {x: 0, y: 48}));
    }
    assert.throws(() => measuredView('384x832', view, {x: -1, y: 48}));
    assert.throws(() => measuredView('384x810', view, {x: 0, y: 48}));
});
