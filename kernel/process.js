
class Process {

    constructor(worker, code, programName, args, pid, streams, ppid, pgid, sid) {
        console.assert(streams != undefined);
        console.assert(Number.isInteger(pid));
        console.assert(Number.isInteger(pgid));
        console.assert(Number.isInteger(sid));
        this.worker = worker;
        this.code = code;
        this.pid = pid; // Process ID
        this.ppid = ppid; // Parent process ID
        this.pgid = pgid // Process group ID
        this.sid = sid; // Session ID
        this.programName = programName;
        this.args = args;
        
        this.streams = streams; // For reading and writing. By convention 0=stdin, 1=stdout
        this.nextStreamId = 0;
        for (let streamId of Object.keys(streams)) {
            streamId = parseInt(streamId);
            this.nextStreamId = Math.max(this.nextStreamId, streamId + 1);
        }
        console.assert(this.nextStreamId != NaN);
        
        this.exitValue = null;
        this.exitWaiters = [];

        this.interruptSignalBehaviour = InterruptSignalBehaviour.EXIT;

        this.nextPromiseId = 1;
        this.syscallHandles = {};
    }

    receiveInterruptSignal() {
        if (this.interruptSignalBehaviour == InterruptSignalBehaviour.EXIT) {
            return true;
        } else if (this.interruptSignalBehaviour == InterruptSignalBehaviour.HANDLE) {
            console.log(`[${this.pid}] Handling interrupt signal. Ongoing syscall promises=${JSON.stringify(this.syscallHandles)}`)
            // Any ongoing syscalls will throw an error that can be
            // caught in the application code.
            for (let id of Object.keys(this.syscallHandles)) {
                this.rejectPromise(id, {name: "ProcessInterrupted", message: "interrupted"});
            }
            
        } else if (this.interruptSignalBehaviour == InterruptSignalBehaviour.IGNORE) {
            console.log(`[${this.pid}] ignoring interrupt signal`)
        }
        return false
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

    rejectPromise(id, error) {
        this.syscallHandles[id].reject(error);
        delete this.syscallHandles[id];
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
        if (outputStream == undefined) {
            throw new SysError("no such stream");
        }
        const {promise, promiseId} = this.promise();
        const self = this;
        outputStream.requestWrite((error) => {
            if (error != null) {
                this.rejectPromise(promiseId, error);
                return null;
            }

            if (self.exitValue != null) {
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
        const reader = ({error, text}) => {
            if (error != undefined) {
                this.rejectPromise(promiseId, error);
                return false; // No read occurred
            }
            const didRead = this.resolvePromise(promiseId, text);
            return didRead;
        }
        inputStream.requestRead({reader, proc: this});
        return promise;
    }

    closeStream(streamId) {
        this.streams[streamId].close();
    }

    /*
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
    */

    addStream(stream) {
        const streamId = this.nextStreamId ++;
        this.streams[streamId] = stream;
        return streamId;
    }

    onExit(exitValue) {
        //console.log(this.pid, "onExit", exitValue);
        this.exitValue = exitValue;

        for (let streamId in this.streams) {
            this.streams[streamId].close();
        }

        this.worker.terminate();

        this.handleExitWaiters();
    }

    handleExitWaiters() {
        if (this.exitValue != null) {
            for (let waiter of this.exitWaiters) {
                //console.log(this.pid, "calling waiter");
                waiter(this.exitValue);
            }
        }
    }

    waitForOtherToExit(otherProc) {
        const {promise, promiseId} = this.promise();
        
        function resolve(exitValue) {
            //console.log(this.pid, "waitForExit was resolved: ", exitValue);
            this.resolvePromise(promiseId, exitValue);
        }

        otherProc.exitWaiters.push(resolve.bind(this));
        otherProc.handleExitWaiters();
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