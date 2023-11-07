"use strict";

async function main(args) {


    const pid1 = await syscall("spawn", {program: "countdown", args: ["4"]});

    const pid2 = await syscall("spawn", {program: "countdown", args: ["6"]});

    await syscall("waitForExit", pid1);

    await syscall("waitForExit", pid2);

    const line = await readln();
}
