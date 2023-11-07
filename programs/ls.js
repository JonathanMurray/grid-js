"use strict";

const STDOUT = 1;

async function main(args) {
    const fileNames = await syscall("listFiles");
    if (fileNames.length > 0) {
        await syscall("write", {output: fileNames, streamId: STDOUT});
    } else {
        await writeln("<no files>");
    }
}


