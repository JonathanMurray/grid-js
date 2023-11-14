
class Process {

    constructor(code, programName, args, system, pid, streams, ppid, pgid, sid) {
        console.assert(streams != undefined);
        console.assert(Number.isInteger(pid));
        console.assert(Number.isInteger(pgid));
        console.assert(Number.isInteger(sid));
        if (args == undefined) {
            args = [];
        }
        this.code = code;
        this.pid = pid; // Process ID
        this.ppid = ppid; // Parent process ID
        this.pgid = pgid // Process group ID
        this.sid = sid; // Session ID
        this.programName = programName;
        this.args = args;
        this.exitWaiters = [];
        this.system = system;
        this.streams = streams; // For reading and writing. By convention 0=stdin, 1=stdout
        
        this.nextStreamId = 0;
        for (let streamId of Object.keys(streams)) {
            streamId = parseInt(streamId);
            this.nextStreamId = Math.max(this.nextStreamId, streamId + 1);
        }
        console.assert(this.nextStreamId != NaN);

        this.hasExited = false;
        this.interruptSignalBehaviour = InterruptSignalBehaviour.EXIT;

        this.ongoingSyscalls = {};

        this.nextPromiseId = 1;
        this.syscallHandles = {};
    }

    receiveInterruptSignal() {
        if (this.interruptSignalBehaviour == InterruptSignalBehaviour.EXIT) {
            this.system.onProcessExit(this.pid);
        } else if (this.interruptSignalBehaviour == InterruptSignalBehaviour.HANDLE) {
            console.log(`[${this.pid}] Handling interrupt signal. Ongoing syscall promises=${JSON.stringify(this.syscallHandles)}`)
            // Any ongoing syscalls will throw an error that can be
            // caught in the application code.
            for (let id of Object.keys(this.syscallHandles)) {
                this.syscallHandles[id].reject({name: "ProcessInterrupted", message: "interrupted"});
                delete this.syscallHandles[id];
            }
        } else if (this.interruptSignalBehaviour == InterruptSignalBehaviour.IGNORE) {
            console.log(`[${this.pid}] ignoring interrupt signal`)
        }
    }

    promise() {
        let resolver;
        let rejector;
        const promise = new Promise((resolve, reject) => {
            resolver = resolve;
            rejector = reject;
        });
        const promiseId = this.nextPromiseId ++;
        this.syscallHandles[promiseId] = {resolve: resolver, reject: rejector};
        return {promise, promiseId};
    }

    resolvePromise(id, result) {
        if (id in this.syscallHandles) {
            this.syscallHandles[id].resolve(result);
            delete this.syscallHandles[id];
            return true;
        }
        // Promise was not resolved. It had likely been rejected already.
        return false;
    }
    
    write(streamId, text) {
        const outputStream = this.streams[streamId];
        console.assert(outputStream != undefined);
        const {promise, promiseId} = this.promise();
        const self = this;
        outputStream.requestWrite(() => {
            if (self.hasExited) {
                return null; // signal that we are no longer attempting to write
            }
            if (this.resolvePromise(promiseId)) {
                return text; // give the text to the stream
            }
            return null; // We ended up not writing.
        });

        return promise;
    }

    read(streamId) {
        const inputStream = this.streams[streamId];
        console.assert(inputStream != undefined, `No stream found with ID ${streamId}. Streams: ${Object.keys(this.streams)}`)
        const {promise, promiseId} = this.promise();
        const reader = (text) => {
            return this.resolvePromise(promiseId, text);
        }
        inputStream.requestRead({reader, proc: this});
        return promise;
    }

    readAny(streamIds) {
        const {promise, promiseId} = this.promise();
        let hasResolvedPromise = false;

        const self = this;
        for (let streamId of streamIds) {
            const inputStream = this.streams[streamId];
            console.assert(inputStream != undefined, `No stream found with ID ${streamId}. Streams: ${Object.keys(this.streams)}`)

            const reader = (text) => {
                if (hasResolvedPromise) {
                    return false; // signal that we ended up not reading 
                }
    
                hasResolvedPromise = this.resolvePromise(promiseId, {text, streamId});
                return hasResolvedPromise;
            };

            inputStream.requestRead({reader, proc: this});
        }

        return promise;
    }

    addStream(stream) {
        const streamId = this.nextStreamId ++;
        this.streams[streamId] = stream;
        return streamId;
    }

    start() {
        const iframe = document.createElement("iframe");
        this.iframe = iframe;
        iframe.sandbox = "allow-scripts";
        iframe.onload = () => {
            iframe.contentWindow.postMessage({startProcess: {programName: this.programName, code: this.code, args: this.args, pid: this.pid}}, "*");
        }
        iframe.src = "sandboxed-process.html";

        this.system.windowManager.createWindow(iframe, this.pid);
    }

    onExit() {
        console.log(this.pid, "onExit");
        this.system.windowManager.removeWindow(this.pid);
        for (let waiter of this.exitWaiters) {
            console.log(this.pid, "calling waiter");
            waiter();
        }
        this.hasExited = true;
    }

    waitForOtherToExit(otherProc) {
        const {promise, promiseId} = this.promise();
        
        function resolve() {
            console.log(this.pid, "waitForExit was resolved!");
            this.resolvePromise(promiseId);
        }

        otherProc.exitWaiters.push(resolve.bind(this));
        return promise;
    }

    sleep(millis) {
        const {promise, promiseId} = this.promise();
        
        const granularityMs = 10;
        const waitUntil = Date.now() + millis;

        function maybeWakeUp() {
            if (Date.now() > waitUntil) {
                this.resolvePromise(promiseId);
            } else {
                setTimeout(maybeWakeUp.bind(this), granularityMs);
            }
        }

        maybeWakeUp.bind(this)();

        return promise;
    }

}