"use strict";

import { writeln, write } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";
import { assert } from "/shared.mjs";

async function main(args) {

    let long = false;
    let paths = [];
    while (args.length > 0) {
        const arg = args.shift();
        if (arg == "-l") {
            long = true;
        } else {
            paths.push(arg);
        }
    }

    if (paths.length == 0) {
        await list(".", long);
    } else {
        for (const path of paths) {
            await list(path, long);
        }
    }
}

async function list(path, long) {
    const filePaths = await syscall("listFiles", {path});

    if (long) {
        let lines = [];
        let widestLength = 0;
        let widestType = 0;
        for (let filePath of filePaths) {
            const status = await syscall("getFileStatus", {filePath});
            let len;
            let type;
            if ("text" in status) {
                len = status.text.length.toString();
                type = "text";
            } else if ("pipe" in status) {
                len = "-";
                type = "pipe";
            } else if ("directory" in status) {
                len = "-";
                type = "dir";
            } else {
                assert(false, `Unhandled file status: ${JSON.stringify(status)}`)
            }
            widestLength = Math.max(widestLength, len.length);
            widestType = Math.max(widestType, type.length);
            lines.push({type, len, filePath});
        }
        for (let {type, len, filePath} of lines) {
            await writeln(`${type.padEnd(widestType)} ${len.padStart(widestLength)} ${filePath}`);
        }
    } else {
        const terminalSize = await syscall("getTerminalSize");
        const terminalWidth = terminalSize[0];
        const interval = 15;
        let lineWidth = 0;
        for (let filePath of filePaths) {
            const len = Math.ceil(filePath.length / interval) * interval;
            const aligned = filePath.padEnd(len, " ");
            if (lineWidth + aligned.length > terminalWidth) {
                await writeln("");
                lineWidth = 0;
            }
            await write(aligned);
            lineWidth += aligned.length;
        }
        await writeln("");
    }
}

