"use strict";

async function main(args) {
    const fileNames = await syscalls.listFiles();
    if (fileNames.length > 0) {
        await syscalls.write(fileNames);
    } else {
        await syscalls.write(["<no files>"]);
    }
}


