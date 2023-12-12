"use strict";

import { write, terminal } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";
import { ansiBackgroundColor, ANSI_ERASE_ENTIRE_SCREEN } from "/shared.mjs";

async function main(args) {
    await syscall("handleInterruptSignal");
    await syscall("configurePseudoTerminal", {mode: "CHARACTER_AND_SIGINT"});
    
    try {
        await terminal.enterAlternateScreen();

        function header(text) {
            return ansiBackgroundColor(text, 44);
        }

        while (true) {

            const procs = await syscall("listProcesses");
            
            let output = ANSI_ERASE_ENTIRE_SCREEN;
            
            output += (`${header("sid")}  ${header("pgid")}  ${header("ppid")}  ${header("pid")}  ` + 
                       `${header("program")}   ${header("activity")} ${header("status")}    ${header("syscalls")} ${header("fds")}\n`);
            for (let proc of procs) {
                const ppid = formatPpid(proc.ppid);
                output += pad(proc.sid, 5) + pad(proc.pgid, 6) + pad(ppid, 6) + pad(proc.pid, 5) + pad(proc.programName, 10) 
                    + pad((proc.userlandActivity * 100).toFixed(0) + "%", 9)
                    + pad(formatExitValue(proc.exitValue), 10) + pad(proc.syscallCount, 9) + Object.keys(proc.fds) + "\n";
            }
            await write(output);

            await syscall("sleep", {millis: 500});
        }
    } catch (error) {
        if (error["name"] != "ProcessInterrupted") {
            throw error;
        }
    } finally {
        await terminal.exitAlternateScreen();
    }
}

function pad(x, len) {
    return x.toString().padEnd(len);
}

function formatPpid(ppid) {
    return ppid != null? ppid : " ";
}

function formatExitValue(exitValue) {
    if (exitValue == null) {
        return "running";
    }
    let str = "" + exitValue;
    if (str == "[object Object]") {
        str = "done";
    }
    return str;
}