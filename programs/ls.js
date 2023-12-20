"use strict";

import { writeln, write, writeError, STDIN } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";
import { FileType, ansiColor, assert, resolvePath } from "/shared.mjs";

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

    const workingDir = await syscall("getWorkingDirectory");

    if (paths.length == 0) {
        await listDirectory(workingDir, long);
    } else {
        
        for (const path of paths) {
            let status;
            try {
                status = await syscall("getFileStatus", {path});
            } catch (e) {
                await writeError(e["message"]);
                return;
            }
            const resolved = "/" + resolvePath(workingDir, path).join("/");
            if (status.type == FileType.DIRECTORY) {
                await listDirectory(resolved, long);
            } else {
                await writeln(resolved);
            }
        }
    }
}

async function listDirectory(path, long) {
    const names = await syscall("listDirectory", {path});

    if (long) {
        let lines = [];
        let widestLength = 0;
        let widestType = 0;
        for (let name of names) {
            const resolved = "/" + resolvePath(path, name).join("/");
            const status = await syscall("getFileStatus", {path: resolved});
            let len;
            const type = status.type;
            if (type == FileType.TEXT) {
                len = status.length.toString();
            } else {
                len = "-";
            }
            widestLength = Math.max(widestLength, len.length);
            widestType = Math.max(widestType, type.length);
            lines.push({type, len, filePath: name});
        }
        for (let {type, len, filePath} of lines) {
            await writeln(`${type.padEnd(widestType)} ${len.padStart(widestLength)} ${filePath}`);
        }
    } else {
        const terminalSize = await syscall("controlDevice", {fd: STDIN, request: {getTerminalSize: null}});
        const terminalWidth = terminalSize[0];
        const interval = 15;
        let lineWidth = 0;
        for (let name of names) {
            const resolved = "/" + resolvePath(path, name).join("/");
            const status = await syscall("getFileStatus", {path: resolved});
            const len = Math.ceil(name.length / interval) * interval;
            const aligned = name.padEnd(len, " ");
            if (lineWidth + aligned.length > terminalWidth) {
                await writeln("");
                lineWidth = 0;
            }
            if (status.type === FileType.DIRECTORY) {
                
                await write(ansiColor(aligned, 35));
            } else {
                await write(aligned);
            }
            lineWidth += aligned.length;
        }
        await writeln("");
    }
}

