import { assert } from "../shared.mjs";

class ProcessSyscaller {

    constructor(pid) {
        this._nextSyscallSequenceNum = 1;
        this._pendingSyscalls = {};
        this._pid = pid;
    }

    async syscall(name, arg) {

        let sequenceNum = this._nextSyscallSequenceNum ++;
        assert(!(sequenceNum in this._pendingSyscalls), `message id ${sequenceNum} in ${JSON.stringify(this._pendingSyscalls)}`);
        let callbacks = {};
        this._pendingSyscalls[sequenceNum] = callbacks;

        assert(this._pid != null, "pid must have been assigned");
        postMessage({syscall: {syscall: name, arg, sequenceNum}});

        const result = new Promise((resolve, reject) => {
            callbacks.resolve = resolve;
            callbacks.reject = reject;
        });
        
        try {
            return await result;
        } catch (e) {
            // Wrap the error so that we get a stacktrace belonging to the worker
            const newError = new Error(e["message"]);
            newError.name = e["name"];
            newError.cause = e;
            newError["errno"] = e["errno"];
            throw newError;
        }
    }

    onSyscallSuccess(sequenceNum, result) {
        this._pendingSyscalls[sequenceNum].resolve(result);
        delete this._pendingSyscalls[sequenceNum];
    }

    onSyscallError(sequenceNum, error) {
        this._pendingSyscalls[sequenceNum].reject(error);
        delete this._pendingSyscalls[sequenceNum];
    }
}

let syscaller = null;
let _pid = null;

export function pid() {
    return _pid;
}

export function init(pid, programName) {
    assert(syscaller == null, "Init called twice");
    _pid = pid;
    syscaller = new ProcessSyscaller(pid);

        
    addEventListener("message", message => {

        try {
            const data = message.data;
            if ("syscallResult" in data) {
                const sequenceNum = data.syscallResult.sequenceNum;
                if ("success" in data.syscallResult) {
                    const result = data.syscallResult.success;
                    syscaller.onSyscallSuccess(sequenceNum, result);
                } else {
                    assert("error" in data.syscallResult);
                    const error = data.syscallResult.error;
                    syscaller.onSyscallError(sequenceNum, error);
                }
            } 
        } catch (error) {
            console.error(pid, programName, "Exception while handling message from kernel", error);
        }
    });
}

export function syscall(name, args) {
    assert(syscaller != null);
    return syscaller.syscall(name, args);
}