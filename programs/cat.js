"use strict";

import { writeError, read, write } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";

import { FileOpenMode } from "/shared.mjs";

async function main(args) {
    let fd;
    if (args.length >= 1) {
        const path = args[0];
        try {
            fd = await syscall("openFile", {path, mode: FileOpenMode.READ});
        } catch (error) {
            await writeError(error["message"]);
            return;
        }
    } else {
       fd = 0; // stdin
    }

    let text = await read(fd);
    while (text != "") {
        await write(text);
        text = await read(fd);
    }
}
