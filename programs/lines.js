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
    } else {
        await writeln("<missing line numbers arg>");
        return;
    }

    if (!(first && last)) {
        await writeln("<invalid line numbers arg>");
        return;
    }

    for (let i = 1; i <= last; i++) {
        const line = await readln();
        if (i >= first) {
            await writeln(`${i} ${line}`);
        }
    }
}


