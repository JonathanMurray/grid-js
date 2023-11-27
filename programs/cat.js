"use strict";

async function main(args) {
    if (args.length >= 1) {
        const fileName = args[0];
        let streamId;
        try {
            streamId = await syscall("openFile", {fileName});
        } catch (error) {
            await writeError(error.message);
            return;
        }
        const text = await syscall("read", {streamId});
        await write(text);
    } else {
        let text = await read();
        while (text != "") {
            await write(text);
            text = await read();
        }
    }
}
