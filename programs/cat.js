"use strict";


const STDOUT = 1;

async function main(args) {
    if (args.length >= 1) {
        const fileName = args[0];
        const lines = await syscall("readFromFile", fileName);
        if (lines == null) {
            await writeln("<no such file>");
        } else {
            for (let line of lines) {
                await writeln(line);
            }
        }
    } else {
        await writeln("<missing filename argument>");
    }
}
