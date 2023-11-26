"use strict";

async function main(args) {
    const fileNames = await syscall("listFiles");
    for (let fileName of fileNames) {
        await writeln(fileName);
    }
}


