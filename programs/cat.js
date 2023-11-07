"use strict";


const STDOUT = 1;

async function main(args) {
    if (args.length >= 1) {
        const fileName = args[0];
        const lines = await syscall("readFromFile", fileName);
        if (lines == null) {
            await writeln("<no such file>");
        } else {
            await syscall("write", {output:lines, streamId: STDOUT});
        }
    } else {
        await writeln("<missing filename argument>");
    }
}
