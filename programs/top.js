"use strict";

async function main(args) {
    await syscall("handleInterruptSignal");
    await syscall("configurePseudoTerminal", {mode: "CHARACTER_AND_SIGINT"});
    
    try {
        await stdlib.terminal.enterAlternateScreen();

        while (true) {

            const procs = await syscall("listProcesses");
            
            let output = ANSI_ERASE_ENTIRE_SCREEN;
            output += "sid  pgid  ppid  pid  program   status    syscalls\n";
            for (let proc of procs) {
                const ppid = formatPpid(proc.ppid);
                output += pad(proc.sid, 5) + pad(proc.pgid, 6) + pad(ppid, 6) + pad(proc.pid, 5) + pad(proc.programName, 10) 
                    + pad(formatExitValue(proc.exitValue), 10) + proc.syscallCount + "\n";
            }
            await write(output);

            await syscall("sleep", {millis: 500});
        }
    } catch (error) {
        if (error.name != "ProcessInterrupted") {
            throw error;
        }
    } finally {
        await stdlib.terminal.exitAlternateScreen();
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
    const str = "" + exitValue;
    return str;
}