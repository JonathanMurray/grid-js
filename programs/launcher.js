"use strict";

async function main(args) {

    await syscall("handleInterruptSignal");

    await writeln("Let's launch some apps!");

    let pids = [];

    pids.push(await syscall("spawn", {program: "sudoku", pgid: "START_NEW"}));
    pids.push(await syscall("spawn", {program: "snake", pgid: "START_NEW"}));
    
    await writeln("Launched: " + pids);

    for (let pid of pids) {
        await syscall("waitForExit", pid);
    }

    await writeln("All apps have stopped running.");
}
