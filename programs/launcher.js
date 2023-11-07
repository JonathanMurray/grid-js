"use strict";

async function main(args) {

    await writeln("Let's launch some apps!");

    let pids = [];

    pids.push(await syscall("spawn", {program: "sudoku"}));
    pids.push(await syscall("spawn", {program: "snake"}));
    
    await writeln("Launched: " + pids);

    for (let pid of pids) {
        await syscall("waitForExit", pid);
    }

    await writeln("All apps have stopped running.");
}
