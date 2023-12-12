import { assert } from "../shared.mjs";
import { SysError } from "./errors.mjs";

export const SignalBehaviour = {
    EXIT: "EXIT",
    IGNORE: "IGNORE",
    HANDLE: "HANDLE"
};


export class Process {

    constructor(worker, code, programName, args, pid, fds, ppid, pgid, sid) {
        assert(fds != undefined);
        assert(Number.isInteger(pid));
        assert(Number.isInteger(pgid));
        assert(Number.isInteger(sid));
        this.programName = programName;
        this.worker = worker;
        this.code = code;
        this.pid = pid; // Process ID
        this.ppid = ppid; // Parent process ID
        this.pgid = pgid // Process group ID
        this.sid = sid; // Session ID
        this.args = args;
        
        /** Maps fd (int) to FileDescriptor
         * By convention, 0=stdin, 1=stdout
         */
        this.fds = fds;

        this._nextFd = 0;
        for (let fdStr of Object.keys(fds)) {
            const fd = parseInt(fdStr);
            this._nextFd = Math.max(this._nextFd, fd + 1);
        }
        assert(!Number.isNaN(this._nextFd));
        
        this.exitValue = null;
        this._exitWaiters = [];

        this.interruptSignalBehaviour = SignalBehaviour.EXIT;

        // Historic count, useful for getting a sense of how busy a process is
        this.syscallCount = 0;
        this._syscallTimestamps = [];
        this._activityWindowMillis = 3000;

        this._nextPromiseId = 1;
        this._ongoingSyscalls = {};
    }

    _forgetOldSyscallTimestamps() {
        
        const nowMillis = Date.now();
        for (let i = this._syscallTimestamps.length - 1; i >= 0; i--) {
            const syscall = this._syscallTimestamps[i];
            
            if (syscall[1] != null) {
                const elapsedSinceEnd = nowMillis - syscall[1];
                if (elapsedSinceEnd > this._activityWindowMillis) {
                    //console.log(`Forgetting the ${i + 1} oldest syscalls`);
                    this._syscallTimestamps = this._syscallTimestamps.slice(i + 1);
                    return;
                }
            }

            const elapsedSinceStart = nowMillis - syscall[0];
            if (elapsedSinceStart > this._activityWindowMillis) {
                this._syscallTimestamps[i][0] = nowMillis - this._activityWindowMillis; // when calculating activity we only back at a limited window
                //console.log(`Forgetting the ${i} oldest syscalls`);
                this._syscallTimestamps = this._syscallTimestamps.slice(i);
                return;
            }
        }
    }

    onSyscallStart() {
        this._forgetOldSyscallTimestamps();
        this.syscallCount += 1;
        const nowMillis = Date.now();
        if (this._syscallTimestamps.length > 0) {
            const lastSyscall = this._syscallTimestamps[this._syscallTimestamps.length - 1];
            assert(lastSyscall[0] != null);
            if (lastSyscall[1] == null) {
                //console.debug("note: a syscall is started while one is already ongoing.");
                return; //We won't try to measure concurrent syscalls in any sophisticated way.
            }
        }
        this._syscallTimestamps.push([nowMillis, null]);
    }

    onSyscallEnd() {
        this._forgetOldSyscallTimestamps();
        const nowMillis = Date.now();
        const idx = this._syscallTimestamps.length - 1;
        const ongoing = this._syscallTimestamps[idx];
        assert(ongoing.length == 2 && ongoing[0] != null);
        if (ongoing[1] != null) {
            //console.debug("note: a syscall ends, but it may have overlapped with other syscalls.");
        }
        this._syscallTimestamps[idx][1] = nowMillis;
    }

    calculateUserlandActivity() {
        this._forgetOldSyscallTimestamps();
        if (this._syscallTimestamps.length == 0) {
            return 1;
        }

        const now = Date.now();
        let total = 0;
        let userland = 0;
        let t;
        const lastSyscall = this._syscallTimestamps[this._syscallTimestamps.length - 1];
        if (lastSyscall[1] == null) {
            // Syscall is ongoing
        } else {
            // No ongoing syscall
            // TODO: apparently not always true. 
            // assert(Object.keys(this._ongoingSyscalls).length == 0);
            userland += now - lastSyscall[1];
        }
        total += now - lastSyscall[0];
        t = lastSyscall[0];

        for (let i = this._syscallTimestamps.length - 2; i >= 0; i--) {
            const syscall = this._syscallTimestamps[i];
            total += t - syscall[0];
            userland += t - syscall[1];
            t = syscall[0];
        }

        const timeCovered = now - t;
        if (timeCovered < this._activityWindowMillis) {
            const missing = this._activityWindowMillis - timeCovered;
            userland += missing;
            total += missing;
        }

        const activity = userland / total;
        return activity;
    }

    getOngoingSyscall() {
        return Object.values(this._ongoingSyscalls).map(x => x.name).join(", ");
    }

    receiveInterruptSignal() {
        const behaviour = this.interruptSignalBehaviour;
        if (behaviour == SignalBehaviour.EXIT) {
            return true;
        } else if (behaviour == SignalBehaviour.HANDLE) {
            console.log(`[${this.pid}] Handling interrupt signal. Ongoing syscall promises=${JSON.stringify(this._ongoingSyscalls)}`)
            // Any ongoing syscalls will throw an error that can be
            // caught in the application code.
            for (let id of Object.keys(this._ongoingSyscalls)) {
                this._rejectPromise(id, {name: "ProcessInterrupted", message: "interrupted"});
            }
        } else if (behaviour == SignalBehaviour.IGNORE) {
            console.log(`[${this.pid}] ignoring interrupt signal`)
        }
        return false
    }

    receiveTerminalResizeSignal() {
        this.worker.postMessage({"terminalResizeSignal": null});;
    }

    _syscallPromise(name) {
        let resolver;
        let rejector;
        const promise = new Promise((resolve, reject) => {
            resolver = resolve;
            rejector = reject;
        });
        const promiseId = this._nextPromiseId ++;
        this._ongoingSyscalls[promiseId] = {resolve: resolver, reject: rejector, name};
        return {promise, promiseId};
    }

    _rejectPromise(id, error) {
        this._ongoingSyscalls[id].reject(error);
        delete this._ongoingSyscalls[id];
    }

    _resolvePromise(id, result) {
        if (id in this._ongoingSyscalls) {
            this._ongoingSyscalls[id].resolve(result);
            delete this._ongoingSyscalls[id];
            return true;
        }
        // Promise was not resolved. It had likely been rejected already.
        return false;
    }
    
    write(fd, text) {
        const fileDescriptor = this.fds[fd];
        if (fileDescriptor == undefined) {
            throw new SysError("no such fd");
        }
        const {promise, promiseId} = this._syscallPromise("write");
        const self = this;
        fileDescriptor.requestWrite((error) => {
            if (error != null) {
                this._rejectPromise(promiseId, error);
                return null;
            }

            if (self.exitValue != null) {
                return null; // signal that we are no longer attempting to write
            }
            if (this._resolvePromise(promiseId)) {
                return text; // give the text to the fd
            }
            return null; // We ended up not writing.
        });

        return promise;
    }

    read(fd, nonBlocking) {
        const fileDescriptor = this.fds[fd];
        assert(fileDescriptor != undefined, `No such fd: ${fd}. file descriptors: ${Object.keys(this.fds)}`)
        const {promise, promiseId} = this._syscallPromise("read");
        const reader = ({error, text}) => {
            if (error != undefined) {
                this._rejectPromise(promiseId, error);
                return false; // No read occurred
            }
            const didRead = this._resolvePromise(promiseId, text);
            return didRead;
        }
        fileDescriptor.requestRead({reader, proc: this, nonBlocking});
        return promise;
    }

    close(fd) {
        this.fds[fd].close();
        delete this.fds[fd];
    }

    addFileDescriptor(fileDescriptor) {
        const fd = this._nextFd ++;
        this.fds[fd] = fileDescriptor;
        return fd;
    }

    setFileLength(fd, length) {
        this.fds[fd].setLength(length);
    }

    seekInFile(fd, position) {
        this.fds[fd].seek(position);
    }

    getFileType(fd) {
        const fileDescriptor = this.fds[fd];
        return fileDescriptor.getFileType();
    }

    onExit(exitValue) {
        assert(exitValue != null);
        console.log(this.pid, "onExit", exitValue);
        this.exitValue = exitValue;

        for (let fd in this.fds) {
            this.fds[fd].close();
        }
        this.fds = {};

        this.worker.terminate();

        this.handleExitWaiters();
    }

    handleExitWaiters() {
        if (this.exitValue != null) {
            for (let waiter of this._exitWaiters) {
                //console.log(this.pid, "calling waiter");
                waiter(this.exitValue);
            }
        }
    }

    waitForOtherToExit(otherProc) {
        const {promise, promiseId} = this._syscallPromise("wait");
        
        const resolve = exitValue => {
            //console.log(this.pid, "waitForExit was resolved: ", exitValue);
            this._resolvePromise(promiseId, exitValue);
        }

        otherProc._exitWaiters.push(resolve);
        otherProc.handleExitWaiters();
        return promise;
    }

    sleep(millis) {
        const {promise, promiseId} = this._syscallPromise("sleep");

        const granularityMs = 10;
        const waitUntil = Date.now() + millis;

        const maybeWakeUp = () => {
            if (Date.now() > waitUntil) {
                this._resolvePromise(promiseId);
            } else {
                setTimeout(maybeWakeUp.bind(this), granularityMs);
            }
        }

        maybeWakeUp();

        return promise;
    }

    joinNewSessionAndProcessGroup() {
        // Note that this has no effect if the process is already session leader and process group leader.
        this.sid = this.pid;
        this.pgid = this.pid;
    }
}