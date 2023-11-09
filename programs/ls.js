"use strict";

async function main(args) {
    const fileNames = await syscall("listFiles");
    if (fileNames.length > 0) {
        for (let fileName of fileNames) {
            await writeln(fileName);
        }
    } else {
        await writeln("<no files>");
    }
}


