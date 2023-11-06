"use strict";

async function main(args) {

    await syscalls.write(["Let's launch some apps!"]);

    let pids = [];

    pids.push(await syscalls.spawn({program: "sudoku"}));
    pids.push(await syscalls.spawn({program: "snake"}));
    
    await syscalls.write(["Launched: " + pids]);

    for (let pid of pids) {
        await syscalls.waitForExit(pid);
    }

    await syscalls.write(["All apps have stopped running."]);
}
