"use strict";

async function main(args) {
    const fileNames = await syscall("listFiles");
    let children = [];
    for (let fileName of fileNames) {
        if (fileName == "diagnose") {
            // Don't recurse
            continue;
        }
        
        try {
            const pid = await syscall("spawn", {program: fileName, streamIds: ["NULL_STREAM", "NULL_STREAM"]});
            children.push([fileName, pid]);
        } catch (e) {
            await writeln(e);
        }
    }

    await syscall("sleep", {millis: 100});

    for (let [fileName, pid] of children) {
        await write(`${pid}/${fileName} -> `);
        await syscall("sendSignal", {signal: "interrupt", pid});
        await syscall("sendSignal", {signal: "kill", pid});
        try {
            const result = await syscall("waitForExit", {pid});
            await writeln(JSON.stringify(result));
        } catch (e) {
            await writeln(`${e.name}: ${e.message}`);
        }
    }
}
