"use strict";

import { read, readEntireFile, writeError, writeln } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";


async function main(args) {
    let text = "";
    if (args.length >= 1) {
        const fileName = args[0];
        try {
            text = await readEntireFile(fileName);
        } catch (error) {
            await writeError(error["message"]);
            return;
        }
    } else {
        while (true) {
            let received = await read();
            if (!received) {
                break;
            }
            text += received;
        }
    }
    const json = JSON.parse(text);
    await writeln(JSON.stringify(json, null, 2));
}

