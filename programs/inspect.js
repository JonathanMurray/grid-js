"use strict";

import { writeError, writeln } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";
import { ansiBackgroundColor } from "/shared.mjs";

async function main(args) {

    if (args.length == 0) {
        await writeError("missing pid argument");
        return;
    } 

    const pid = Number.parseInt(args[0]);

    if (!Number.isInteger(pid)) {
        await writeError("invalid pid argument");
        return;
    }

    const procs = await syscall("listProcesses");

    for (let proc of procs) {
        if (proc.pid == pid) {
            writeln(`${ansiBackgroundColor(proc.programName, 45)}`);
            writeln("-----------------");
            writeln(` sid: ${proc.sid}`);
            writeln(`pgid: ${proc.pgid}`);
            writeln(`ppid: ${proc.ppid}`);
            writeln(`\nfile descriptors:`);
            for (const [fd, value] of Object.entries(proc.fds)) {
                writeln(`${fd}: ${value}`);
            }
            await syscall("exit");
        }
    }

    await writeError("no such process: " + pid);
}
