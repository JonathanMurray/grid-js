"use strict";

async function main(args) {
    if (args.length >= 1) {
        const fileName = args[0];
        const lines = await syscalls.readFromFile(fileName);
        if (lines == null) {
            await syscalls.write(["<no such file>"]);
        } else {
            await syscalls.write(lines);
        }
    } else {
        await syscalls.write(["<missing filename argument>"]);
    }
}
