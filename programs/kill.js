"use strict";

import { writeError } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";

async function main(args) {
    if (args.length >= 1) {
        const pid = args[0];
        try {
            await syscall("sendSignal", {signal: "kill", pid});
        } catch (e) {
            await writeError(e["message"]);
        }
    } else {
        await writeError("missing pid argument");
    }
}
