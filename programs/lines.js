"use strict";

async function main(args) {

    let first;
    let last;
    if (args.length > 0) {
        const lineArgs = args[0].split("-");
        if (lineArgs.length <= 2) {
            first = parseInt(lineArgs[0]);
            last = parseInt(lineArgs[lineArgs.length - 1]);
        }
        if (!(first && last)) {
            await writeError("invalid line numbers arg");
            return;
        }
    } else {
        first = 1;
        last = Number.MAX_SAFE_INTEGER;
    }

    for (let i = 1; i <= last; i++) {
        const line = await readln();
        if (line == null) {
            // end of stream
            break;
        }
        if (i >= first) {
            await writeln(`${i.toString().padEnd(2)} ${line}`);
        }
    }
}


