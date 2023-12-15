"use strict";

import { writeError, read, write, readln, BufferedReader, writeln } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";
import { ANSI_CSI } from "/shared.mjs";


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

    await writeln(`${ANSI_CSI}37;45mJavaScript REPL:${ANSI_CSI}39;49m`);

    const reader = new BufferedReader(fd);
    let program = "";
    let line = await reader.readLine();
    while (line != "") {
        try {
            const output = eval(program + line);
            program += line + "\n";
            if (output != undefined) {
                await writeln(`${ANSI_CSI}37;45m${output}${ANSI_CSI}39;49m`);
            }
        } catch (e) {
            console.error(e);
            writeError(e);
        }
        
        line = await reader.readLine();
    }
}

