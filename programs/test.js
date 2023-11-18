"use strict";

async function main(args) {

    const streamId = await syscall("openFile", {fileName: "textfile"});
    await writeln(`opened file: ${streamId}`);

    let text = await syscall("read", {streamId});
    await writeln(`Read text: '${text}'`);

    text = await syscall("read", {streamId});
    await writeln(`Read text: '${text}'`);
    
}
