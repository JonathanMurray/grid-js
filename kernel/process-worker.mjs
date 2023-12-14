// This file runs a process, sandboxed in a web worker
// https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers

import * as sys from "../lib/sys.mjs";
import { assert } from "../shared.mjs";

async function sandbox(programName, code, args) {

    // Get the program's main function out of the async function, so that we can evaluate it here
    code += "\nself.main = main";

    // This allows programs to be written as if they are the body of an async function,
    // i.e. they can do top level await (for example to import dependencies).
    await Object.getPrototypeOf(async function() {}).constructor(code)();
   
    return self["main"](args);
}

let pid = null;
let programName = null;

let terminalResizeSignalHandler = () => {};

self.handleTerminalResizeSignal = (x) => terminalResizeSignalHandler = x;

async function onProgramCrashed(error) {
    console.warn(`[${pid}] ${programName} crashed: `, error);
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
            programName = data.startProcess.programName;

            sys.init(pid, programName);

            let code = data.startProcess.code;

            //  DEBUG(expr) is a "macro", available to application code.
            code = code.replaceAll(/DEBUG\(([^;]+)\)/g, `console.log("[${pid}]", "${programName} DEBUG($1):", $1);`);

            // Replace module-style import statements (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/import)
            // with dynamic import statements (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import).
            // The program is not run as a module, but inside an asynchronous function, so module-style imports don't work.
            // However, for development purposes, it seems to be more IDE-friendly to pretend that our programs are modules.
            code = code.replaceAll(/import (.+) from "\/(.+)";/g, "const $1 = await import(\"../$2\");");

            try {
                const result = sandbox(programName, code, args);
                Promise.resolve(result)
                    .then((value) => { console.debug("Program result: ", value); sys.syscall("exit");})
                    .catch((e) => { onProgramCrashed(e); });
            } catch (e) {
                onProgramCrashed(e);
            }

        } else if ("terminalResizeSignal" in data) {
            terminalResizeSignalHandler();
        } else if ("syscallResult" in data) {
            //Handled in sys.mjs
        } else {
            console.error("Unhandled message in process worker", data);
        }
    } catch (error) {
        console.error(pid, programName, "Exception while handling message from kernel", error);
    }
});

// tell the kernel that we're ready to receive messages
postMessage({initDone: true});

