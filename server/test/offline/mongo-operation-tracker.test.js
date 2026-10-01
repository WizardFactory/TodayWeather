'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createOperationTracker} = require('./mongo-operation-tracker');

test('drain waits for held callbacks and preserves model receiver and return value', async () => {
    const tracker = createOperationTracker();
    let complete;
    const model = {updateOne(...args) { assert.equal(this, model); complete = args.pop(); return 'query'; }};
    const tracked = tracker.wrap(model, 'usage', ['updateOne']);
    assert.equal(tracked.updateOne({}, {}, {}, () => {}), 'query');
    let drained = false;
    const pending = tracker.drain().then(() => { drained = true; });
    await Promise.resolve();
    assert.equal(drained, false, 'response completion does not mean the Mongo callback finished');
    complete(null, {ok: 1});
    await pending;
    assert.equal(tracker.pending(), 0);
});

test('drain includes retry work started inside a completed callback', async () => {
    const tracker = createOperationTracker();
    const callbacks = [];
    const tracked = tracker.wrap({updateOne(...args) { callbacks.push(args.pop()); }}, 'usage', ['updateOne']);
    tracked.updateOne({}, {}, () => tracked.updateOne({}, {}, () => {}));
    let drained = false;
    const pending = tracker.drain().then(() => { drained = true; });
    callbacks.shift()(null);
    await Promise.resolve();
    assert.equal(drained, false);
    callbacks.shift()(null);
    await pending;
});

test('missing callbacks fail with operation identity instead of hanging or passing', async () => {
    const tracker = createOperationTracker();
    tracker.wrap({deleteOne() {}}, 'lock', ['deleteOne']).deleteOne({}, () => {});
    await assert.rejects(tracker.drain(10), /Timed out.*lock.deleteOne/);
});

test('synchronous model errors release tracking and propagate', async () => {
    const tracker = createOperationTracker();
    const tracked = tracker.wrap({updateOne() { throw new Error('database unavailable'); }}, 'usage', ['updateOne']);
    assert.throws(() => tracked.updateOne({}, {}, () => {}), /database unavailable/);
    await tracker.drain();
    assert.equal(tracker.pending(), 0);
});

test('callback errors are passed to production callback, and missing callback API is rejected', async () => {
    const tracker = createOperationTracker();
    const error = new Error('write failed');
    let received;
    const tracked = tracker.wrap({updateOne(...args) { args.pop()(error); }}, 'usage', ['updateOne']);
    tracked.updateOne({}, {}, e => { received = e; });
    await tracker.drain();
    assert.equal(received, error);
    assert.throws(() => tracked.updateOne({}, {}), /requires a callback/);
});
