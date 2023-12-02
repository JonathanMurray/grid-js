"use strict";

async function main(args) {

    let long = false;
    if (args.length > 0) {
        if (args[0] == "-l") {
            long = true;
        }
    }

    const fileNames = await syscall("listFiles");

    if (long) {
        let lines = [];
        let widestLength = 0;
        let widestType = 0;
        for (let fileName of fileNames) {
            const status = await syscall("getFileStatus", {fileName});
            let len;
            let type;
            if ("text" in status) {
                len = status.text.length.toString();
                type = "text";
            } else if ("pipe" in status) {
                len = "-";
                type = "pipe";
            } else {
                assert(false, `Unhandled file status: ${JSON.stringify(status)}`)
            }
            widestLength = Math.max(widestLength, len.length);
            widestType = Math.max(widestType, type.length);
            lines.push({type, len, fileName});
        }
        for (let {type, len, fileName} of lines) {
            await writeln(`${type.padEnd(widestType)} ${len.padStart(widestLength)} ${fileName}`);
        }
    } else {
        for (let fileName of fileNames) {
            await write(`${fileName}  `)   ;
        }
        await writeln("");
    }
}


