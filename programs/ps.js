"use strict";

async function main(args) {
    const procs = await syscall("listProcesses");
    if (procs.length > 0) {
        await writeln("sid  pgid  ppid  pid  program   status")
        for (let proc of procs) {
            const ppid = formatPpid(proc.ppid);
            await writeln(pad(proc.sid, 5) + pad(proc.pgid, 6) + pad(ppid, 6) + 
                pad(proc.pid, 5) + pad(proc.programName, 10) + formatExitValue(proc.exitValue))
        }
    } else {
        await writeln("<no running processes>");
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
    const maxLen = 40;
    if (str.length > maxLen) {
        return str.slice(0, maxLen - 3) + "...";
    }
    return str;
}