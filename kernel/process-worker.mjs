// This file runs a process, sandboxed in a web worker
// https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers

self.stdlib = await import("../lib/stdlib.mjs");
// Make these parts of stdlib globally available in programs
for (const key in stdlib) {
    self[key] = stdlib[key];
}

const util = await import("../util.mjs");
// Make all parts of util globally available in programs
for (const key in util) {
    self[key] = util[key];
}

async function sandbox(code, args) {

    // Get the program's main function out of the async function, so that we can evaluate it here
    code += "\nself.main = main";

    // This allows programs to be written as if they are the body of an async function,
    // i.e. they can do top level await (for example to import dependencies).
    await Object.getPrototypeOf(async function() {}).constructor(code)();

    return main(args);
}

let nextSyscallSequenceNum = 1;
let pendingSyscalls = {};

let pid = null;
let programName = null;

let windowInputHandler = null;
let terminalResizeSignalHandler = () => {};

self.handleWindowInput = (x) => windowInputHandler = x;
self.handleTerminalResizeSignal = (x) => terminalResizeSignalHandler = x;

self.syscall = async function(name, arg) {

    let sequenceNum = nextSyscallSequenceNum ++;
    assert(!(sequenceNum in pendingSyscalls), `message id ${sequenceNum} in ${JSON.stringify(pendingSyscalls)}`);
    let callbacks = {};
    pendingSyscalls[sequenceNum] = callbacks;

    assert(pid != null, "pid must have been assigned");
    postMessage({syscall: {syscall: name, arg, sequenceNum}});

    const result = new Promise((resolve, reject) => {
        callbacks.resolve = resolve;
        callbacks.reject = reject;
    });
    
    try {
        return await result;
    } catch (e) {
        // Wrap the error so that we get a stacktrace belonging to the worker
        const newError = new Error(e.message);
        newError.name = e.name;
        newError.cause = e;
        newError.errno = e.errno;
        throw newError;
    }
}

function onSyscallSuccess(sequenceNum, result) {
    pendingSyscalls[sequenceNum].resolve(result);
    delete pendingSyscalls[sequenceNum];
}

function onSyscallError(sequenceNum, error) {
    pendingSyscalls[sequenceNum].reject(error);
    delete pendingSyscalls[sequenceNum];
}

async function onProgramCrashed(error) {
    console.warn(`[${pid}] Program crashed: `, error);
    console.warn(`[${pid}] Caused by: `, error.cause);
    postMessage({crashed: error});
}
    
addEventListener("message", message => {

    try {

        const data = message.data;

        if ("startProcess" in data) {
            
            assert("programName" in data.startProcess);
            assert("code" in data.startProcess);
            assert("args" in data.startProcess);
            assert("pid" in data.startProcess);
            assert(pid == null);

            const {args} = data.startProcess;
            pid = data.startProcess.pid;
            self.pid = pid;
            programName = data.startProcess.programName;
            let code = data.startProcess.code;

            //  DEBUG(expr) is a "macro", available to application code.
            code = code.replaceAll(/DEBUG\(([^;]+)\)/g, `console.log("[${pid}]", "${programName} DEBUG($1):", $1);`)

            try {
                const result = sandbox(code, args);
                Promise.resolve(result)
                    .then((value) => { console.debug("Program result: ", value); syscall("exit");})
                    .catch((e) => { onProgramCrashed(e); });
            } catch (e) {
                onProgramCrashed(e);
            }

        } else if ("syscallResult" in data) {
            assert(pid != null);
            const sequenceNum = data.syscallResult.sequenceNum;
            if ("success" in data.syscallResult) {
                const result = data.syscallResult.success;
                onSyscallSuccess(sequenceNum, result);
            } else {
                assert("error" in data.syscallResult);
                const error = data.syscallResult.error;
                onSyscallError(sequenceNum, error);
            }
        } else if ("userInput" in data) {
            windowInputHandler(data.userInput.name, data.userInput.event);
        } else if ("terminalResizeSignal" in data) {
            terminalResizeSignalHandler();
        } else {
            console.error("Unhandled message in program iframe", data);
        }
    } catch (error) {
        console.error(pid, programName, "Exception while handling message from kernel", error);
    }
});

// tell the kernel that we're ready to receive messages
postMessage({initDone: true});

