
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
        this.promiseCallbacks = {};
    }

    receiveInterruptSignal() {
        if (this.interruptSignalBehaviour == InterruptSignalBehaviour.EXIT) {
            this.system.onProcessExit(this.pid);
        } else if (this.interruptSignalBehaviour == InterruptSignalBehaviour.HANDLE) {
            console.log(`[${this.pid}] Handling interrupt signal. Ongoing syscall promises=${JSON.stringify(this.promiseCallbacks)}`)
            // Any ongoing syscalls will throw an error that can be
            // caught in the application code.
            for (let id of Object.keys(this.promiseCallbacks)) {
                this.promiseCallbacks[id].reject({name: "ProcessInterrupted", message: "interrupted"});
                delete this.promiseCallbacks[id];
            }
        } else if (this.interruptSignalBehaviour == InterruptSignalBehaviour.IGNORE) {
            //console.debug(`[${this.pid}] ignoring interrupt signal`)
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
        this.promiseCallbacks[promiseId] = {resolve: resolver, reject: rejector};
        return {promise, promiseId};
    }

    resolvePromise(id, result) {
        if (id in this.promiseCallbacks) {
            this.promiseCallbacks[id].resolve(result);
            delete this.promiseCallbacks[id];
            return true;
        }
        // Promise was not resolved. It had likely been rejected already.
        return false;
    }
    
    write(streamId, line) {
        const outputStream = this.streams[streamId];
        console.assert(outputStream != undefined);
        const {promise, promiseId} = this.promise();
        const self = this;
        outputStream.requestWrite(() => {
            if (self.hasExited) {
                return null; // signal that we are no longer attempting to write
            }
            if (this.resolvePromise(promiseId)) {
                return line; // give the line to the stream
            }
            return null; // We ended up not writing.
        });

        return promise;
    }

    read(streamId) {
        const inputStream = this.streams[streamId];
        console.assert(inputStream != undefined, `No stream found with ID ${streamId}. Streams: ${Object.keys(this.streams)}`)
        const {promise, promiseId} = this.promise();
        const reader = (line) => {
            return this.resolvePromise(promiseId, line);
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

            const reader = (line) => {
                if (hasResolvedPromise) {
                    return false; // signal that we ended up not reading the line
                }
    
                hasResolvedPromise = this.resolvePromise(promiseId, {line, streamId});
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

        iframe.src = "sandboxed-program.html";

        const header = document.createElement("div");
        header.classList.add("program-window-header");
        header.style = "background:lightgray; font-family: system-ui; font-weight: bold;";
        header.innerHTML = "Program sandbox";
        
        const programWindow = document.createElement("div");
        this.programWindow = programWindow;
        programWindow.style = "display: none; position: absolute; background: white; user-select: none;";
        programWindow.id = "program-window-" + this.pid;
        programWindow.classList.add("program-window");

        programWindow.appendChild(header);
        programWindow.appendChild(iframe);

        programWindow.addEventListener("mousedown", (event) => {
            const left = parseInt(programWindow.style.left.replace("px", "")) || programWindow.getBoundingClientRect().x;
            const top = parseInt(programWindow.style.top.replace("px", "")) || programWindow.getBoundingClientRect().y;
            this.system.draggingWindow = {element: programWindow, offset: [event.x - left, event.y - top], iframe};
            this.system.focusProgramWindow(programWindow);
        });

        iframe.addEventListener("mousedown", (event) => {
            programWindow.classList.add("focused");
        });

        iframe.addEventListener("focus", (event) => {
            programWindow.classList.add("focused");
        });
        header.addEventListener("focus", (event) => {
            programWindow.classList.add("focused");
        });

        iframe.addEventListener("blur", (event) => {
            programWindow.classList.remove("focused");
        });

        document.getElementsByTagName("body")[0].appendChild(programWindow);
    }

    onExit() {
        this.programWindow.remove();
        for (let waiter of this.exitWaiters) {
            waiter();
        }
        this.hasExited = true;
    }

    waitForExit() {
        let waiter;
        // TODO handle properly so that it can be interrupted
        const exitPromise = new Promise((resolve) => waiter = resolve);
        this.exitWaiters.push(waiter);
        return exitPromise;
    }

}