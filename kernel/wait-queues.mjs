import { assert } from "../shared.mjs";

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

    async waitFor(name, conditionCallback) {
        assert(name in this._queues);
        if (conditionCallback()) {
            return;
        }

        while (true) {
            let wakeMeUp;
            const awoken = new Promise(r => wakeMeUp = r);
            this._queues[name].push(wakeMeUp);

            // Going to sleep
            await awoken;
            // Woke up

            // It's important that the condition is checked here where the
            // process runs exclusively on the kernel thread (rather than
            // from the thread that triggers the awakening). This process may end
            // up altering state (like reading all available data from pipe) in
            // such a way that subsequently awoken processes will want to go back
            // to sleep.
            // (It's also important that we actually commit whatever actions we
            // were waiting to do, before releasing the thread again.)
            if (conditionCallback()) {
                return;
            }
            // back to sleep
        }
    }

    wakeup(name) {
        assert(name in this._queues);
        for (const wakeupSleepingProcess of this._queues[name]) {
            wakeupSleepingProcess();
        }
        this._queues[name] = [];
    }
}