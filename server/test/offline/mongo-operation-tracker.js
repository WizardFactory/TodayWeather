'use strict';

// Test-only observer: use the real model and callback, without changing controller ordering.
exports.createOperationTracker = function () {
    const operations = new Map();
    const waiters = new Set();
    let sequence = 0;
    function finish(id) {
        operations.delete(id);
        if (!operations.size) for (const resolve of [...waiters]) resolve();
    }
    return {
        pending: () => operations.size,
        wrap(model, name, methods) {
            return new Proxy(model, {
                get(target, key) {
                    const value = Reflect.get(target, key, target);
                    if (typeof value !== 'function') return value;
                    if (!methods.includes(key)) return value.bind(target);
                    return (...args) => {
                        const callback = args.pop();
                        if (typeof callback !== 'function') throw new Error(name + '.' + key + ' requires a callback');
                        const id = ++sequence;
                        operations.set(id, name + '.' + key);
                        args.push(function (...results) {
                            // Retries started by the controller callback are registered before this finishes.
                            try { return callback.apply(this, results); }
                            finally { finish(id); }
                        });
                        try { return value.apply(target, args); }
                        catch (error) { finish(id); throw error; }
                    };
                }
            });
        },
        drain(timeoutMs = 10000) {
            if (!operations.size) return Promise.resolve();
            return new Promise((resolve, reject) => {
                const done = () => { clearTimeout(timer); waiters.delete(done); resolve(); };
                const timer = setTimeout(() => {
                    waiters.delete(done);
                    reject(new Error('Timed out waiting for Mongo callbacks: ' + [...operations.values()].join(', ')));
                }, timeoutMs);
                waiters.add(done);
            });
        }
    };
};
