"use strict";

import { writeln, write, read } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";

async function main(args) {
    let fileNames = await syscall("listDirectory", {path: "/"});

    let children = [];
    const nullFd = await syscall("openFile", {filePath: "null"});
    for (let fileName of fileNames) {
        if (fileName == "diagnose") {
            // Don't recurse
            continue;
        }
        
        const {readerId, writerId} = await syscall("createPipe");
        try {
            const pid = await syscall("spawn", {programPath: fileName, fds: [nullFd, writerId]});
            children.push({filePath: fileName, pid, pipeReaderId: readerId});
        } catch (e) {
            await writeln(`Failed to start ${fileName}: ${e}`);
        }
        await syscall("close", {fd: writerId});
    }

    await syscall("sleep", {millis: 100});

    for (let {filePath, pid, pipeReaderId} of children) {
        await write(`${pid}/${filePath} -> `);
        await syscall("sendSignal", {signal: "interrupt", pid});
        await syscall("sendSignal", {signal: "kill", pid});
        try {
            const result = await syscall("waitForExit", {pid});
            await writeln(JSON.stringify(result));
        } catch (e) {
            await writeln(`${e["name"]}: Exception: ${e["message"]}`);
            await writeln("Failing process output: ")
            const output = await read(pipeReaderId);
            await writeln(output);
        }
    }
}
