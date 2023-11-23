"use strict";

async function main(args) {
    if (args.length >= 1) {
        const fileName = args[0];
        const streamId = await syscall("openFile", {fileName});
        const text = await syscall("read", {streamId});
        if (text == null) {
            await writeln("<no such file>");
        } else {
            await write(text);
        }
    } else {
        let line = await readln();
        while (line != null) {
            await writeln(line);
            line = await readln();
        }
    }
}
