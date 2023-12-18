import { assert } from "/shared.mjs";

export class WaitQueues {
    constructor() {
        this._queues = {};
    }
    
    addQueue(name) {
        assert(!(name in this._queues));
        this._queues[name] = [];
    }

    removeQueue(name) {
        assert(name in this._queues);
        delete this._queues[name];
    }
    
    waitFor(name, callback) {
        assert(name in this._queues);
        this._queues[name].push(callback);
    }

    wakeup(name, value) {
        assert(name in this._queues);
        for (const callback of this._queues[name]) {
            callback(value);
        }
        this._queues[name] = [];
    }
}