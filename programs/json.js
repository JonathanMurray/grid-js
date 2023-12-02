"use strict";

async function main(args) {
    let text = "";
    if (args.length >= 1) {
        const fileName = args[0];
        let fd;
        try {
            fd = await syscall("openFile", {fileName});
        } catch (error) {
            await writeError(error.message);
            return;
        }
        text = await syscall("read", {fd});
    } else {
        while (true) {
            let received = await read();
            if (!received) {
                break;
            }
            text += received;
        }
    }
    const json = JSON.parse(text);
    await writeln(JSON.stringify(json, null, 2));
}

