// This file runs a process, sandboxed in a web worker
// https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers

importScripts("/lib/stdlib.js", "/lib/grid.js", "/lib/text-grid.js");
const {write, writeln, readln, log} = stdlib;

function sandbox(code, args) {
    eval(code);
    return main(args);
}

(function () {

    let nextSyscallSequenceNum = 1;
    let pendingSyscalls = {};
    
    let pid = null;
    let code = null;
    let programName = null;

    let inputListener = null;

    this.setInputListener = (x) => inputListener = x;

    this.syscall = async function(name, arg) {

        let sequenceNum = nextSyscallSequenceNum ++;
        console.assert(!(sequenceNum in pendingSyscalls), `message id ${sequenceNum} in ${JSON.stringify(pendingSyscalls)}`);
        let callbacks = {};
        pendingSyscalls[sequenceNum] = callbacks;

        console.assert(pid != null, "pid must have been assigned");
        postMessage({syscall: {syscall: name, arg, pid, sequenceNum}});

        const result = new Promise((resolve, reject) => {
            callbacks.resolve = resolve;
            callbacks.reject = reject;
        });
        console.debug("created syscall promise...");
        
        try {
            return await result;
        } catch (e) {
            // Wrap the error so that we get a stacktrace belonging to the worker
            const newError = new Error(e.message);
            newError.name = e.name;
            newError.cause = e;
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

        await writeln(`[${pid}] crashed!`);
        
        if (error.stack) {
            const stackLines = error.stack.split('\n');

            let hasStartedWritingStackLines = false;

            const regex = /\((.+):(.+):(.+)\)/;
            for (let stackLine of stackLines) {
                const match = stackLine.match(regex);
                if (match) {
                    const fileName = match[1];
                    if (fileName.startsWith("eval at") && fileName.endsWith("<anonymous>")) {
                        const headerLen = 1; // Runnable file starts with a header that is stripped off before we execute it
                        const lineNumber = parseInt(match[2]) + headerLen;
                        const colNumber = parseInt(match[3]);
                        const translatedStackLine = stackLine.replace(regex, `(${programName}:${lineNumber}:${colNumber})`);
                        await writeln(translatedStackLine);
                        hasStartedWritingStackLines = true;
                    }
                } else if (!hasStartedWritingStackLines) {
                    await writeln(stackLine);
                }
            }
        }
        
        await syscall('exit', error);
    }
        
    addEventListener("message", message => {

        const data = message.data;

        if ("startProcess" in data) {
            
            console.assert("programName" in data.startProcess);
            console.assert("code" in data.startProcess);
            console.assert("args" in data.startProcess);
            console.assert("pid" in data.startProcess);
            console.assert(pid == null);

            const {args} = data.startProcess;
            pid = data.startProcess.pid;
            programName = data.startProcess.programName;
            code = data.startProcess.code;

            // in 'strict mode' eval:ed code is not allowed to declare new variables, so without this main doesn't make it out of the eval
            code += "\nthis.main = main";

            try {
                result = sandbox(code, args);
                Promise.resolve(result)
                    .then((value) => { console.log("Program result: ", value); syscall("exit");})
                    .catch((e) => { onProgramCrashed(e); });
            } catch (e) {
                onProgramCrashed(e);
            }

        } else if ("syscallResult" in data) {
            console.assert(pid != null);
            const sequenceNum = data.syscallResult.sequenceNum;
            if ("success" in data.syscallResult) {
                const result = data.syscallResult.success;
                onSyscallSuccess(sequenceNum, result);
            } else {
                console.assert("error" in data.syscallResult);
                const error = data.syscallResult.error;
                onSyscallError(sequenceNum, error);
            }
        } else if ("userInput" in data) {
            inputListener(data.userInput.name, data.userInput.event);
        } else {
            console.error("Unhandled message in program iframe", data);
        }

    });

})();
