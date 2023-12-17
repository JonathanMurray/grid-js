"use strict";

import { writeln, write, read } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";

async function main(args) {
    let filePaths = await syscall("listFiles", {path: "/"});

    let children = [];
    const nullFd = await syscall("openFile", {filePath: "null"});
    for (let filePath of filePaths) {
        if (filePath == "diagnose") {
            // Don't recurse
            continue;
        }
        
        const {readerId, writerId} = await syscall("createPipe");
        try {
            const pid = await syscall("spawn", {programPath: filePath, fds: [nullFd, writerId]});
            children.push({filePath, pid, pipeReaderId: readerId});
        } catch (e) {
            await writeln(`Failed to start ${filePath}: ${e}`);
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
