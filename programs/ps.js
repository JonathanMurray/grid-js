"use strict";

async function main(args) {
    const procs = await syscall("listProcesses");
    if (procs.length > 0) {
        await writeln("pgid  ppid  pid  program")
        for (let proc of procs) {
            const ppid = proc.ppid != null? proc.ppid : " ";
            await writeln(proc.pgid + "     " + ppid + "     " + proc.pid + "    " + proc.programName)
        }
    } else {
        await writeln("<no running processes>");
    }
}

