class IframeServer {

    constructor(system) {
        this.system = system;
        this.iframes = {};

        window.addEventListener("message", message => {
            this.handleMessage(message);
        });
    }

    initializeNewIframe(iframe, programName, code, args, pid) {
        this.iframes[pid] = iframe;
        iframe.contentWindow.postMessage({startProcess: {programName, code, args, pid}}, "*");
    }

    handleMessage(message) {
        if ("syscall" in message.data) {
            // Sandboxed programs send us syscalls from iframe
            this.handleSyscallMessage(message);
        } else {
            console.assert("iframeReceivedFocus" in message.data);
            const pid = message.data.iframeReceivedFocus.pid;
            this.system.windowManager.focusWindow(pid);
        }
    }

    handleSyscallMessage(message) {
        const {syscall, arg, pid, sequenceNum} = message.data.syscall;

        //console.log(`[${pid}] ${syscall}(${JSON.stringify(arg)}) ...`);
        this.system.call(syscall, arg, pid).then((result) => {
            console.log(`[${pid}] ${syscall}(${JSON.stringify(arg)}) --> ${JSON.stringify(result)}`);
            this.onSyscallResult(pid, {success: result, sequenceNum});
        }).catch((error) => {
            if (error instanceof SysError || error.name == "ProcessInterrupted" || error.name == "SysError") {
                console.warn(`[${pid}] ${syscall}(${JSON.stringify(arg)}) --> `, error);
            } else {
                console.error(`[${pid}] ${syscall}(${JSON.stringify(arg)}) --> `, error);
                console.error(error.name);
            }
            this.onSyscallResult(pid, {error, sequenceNum});
        });
    }

    onSyscallResult(pid, result) {
        const iframe = this.iframes[pid];
        if (iframe.contentWindow) {
            iframe.contentWindow.postMessage({syscallResult: result}, "*");
            console.debug("Sent syscall error to program iframe");
        } else {
            console.info("iframe no longer exists. Can't post syscall result.");
            delete this.iframes[pid];
        }
    }
}

class IframeClient {
    constructor(onReceivedStart) {
        this.process = null;
        this.nextSyscallSequenceNum = 1;
        this.pendingSyscalls = {};
        this.onReceivedStart = onReceivedStart;

        const self = this;
        window.addEventListener("message", message => {
            self.handleMessage(message);
        });
    }

    demandWindowFocus() {
        parent.postMessage({iframeReceivedFocus: {pid: this.process.pid}}, "*");
    }

    handleMessage(message) {

        console.debug("Sandboxed program received message:", message.data);

        if ("startProcess" in message.data) {
            console.assert("programName" in message.data.startProcess);
            console.assert("code" in message.data.startProcess);
            console.assert("args" in message.data.startProcess);
            console.assert("pid" in message.data.startProcess);
            console.assert(this.process == null);
            this.process = message.data.startProcess;
            console.log("HERE __> ", this.process);
            this.onReceivedStart(this.process);
        } else if ("syscallResult" in message.data) {
            console.assert(this.process != null);
            const sequenceNum = message.data.syscallResult.sequenceNum;
            if ("success" in message.data.syscallResult) {
                const result = message.data.syscallResult.success;
                this.resolve(sequenceNum, result);
            } else {
                console.assert("error" in message.data.syscallResult);
                const error = message.data.syscallResult.error;
                this.reject(sequenceNum, error);
            }
        } else {
            console.error("Unhandled message in program iframe", message.data);
        }
    }

    async call(syscall, arg) {

        console.log(this.process.pid, "syscall ", syscall, arg);
        
        if (arg == undefined) {
            // Syscall implementations that try to destructure args crash otherwise
            arg = {};
        }

        let sequenceNum = this.nextSyscallSequenceNum ++;
        console.assert(!(sequenceNum in this.pendingSyscalls), `message id ${sequenceNum} in ${JSON.stringify(this.pendingSyscalls)}`);
        let callbacks = {};
        this.pendingSyscalls[sequenceNum] = callbacks;

        console.debug("posting syscall...");
        console.assert(this.process.pid != null, "pid must have been assigned");
        parent.postMessage({syscall: {syscall, arg, pid: this.process.pid, sequenceNum}}, "*");
        console.debug("posted syscall...");

        const asyncSyscallResult = new Promise((resolve, reject) => {
            callbacks.resolve = resolve;
            callbacks.reject = reject;
        });
        console.debug("created syscall promise...");
        
        try {
            return await asyncSyscallResult;
        } catch (e) {
            const newError = new Error(e.message);
            newError.name = e.name;
            newError.cause = e;
            throw newError;
        }
    }

    resolve(sequenceNum, result) {
        console.debug("Received syscall result in iframe: ", result);
        this.pendingSyscalls[sequenceNum].resolve(result);
        delete this.pendingSyscalls[sequenceNum]; // avoid leaking memory
    }

    reject(sequenceNum, error) {
        console.debug("Received syscall error in iframe: ", error);
        this.pendingSyscalls[sequenceNum].reject(error);
        delete this.pendingSyscalls[sequenceNum]; // avoid leaking memory
    }
}