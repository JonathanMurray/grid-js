"use strict";

import { writeError, read, write } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";

async function main(args) {
    let fd;
    if (args.length >= 1) {
        const fileName = args[0];
        try {
            fd = await syscall("openFile", {fileName});
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
