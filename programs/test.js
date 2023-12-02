"use strict";

async function main(args) {

    const fd = await syscall("openFile", {fileName: "textfile"});
    await writeln(`opened file: ${fd}`);

    let text = await syscall("read", {fd});
    await writeln(`Read text: '${text}'`);

    text = await syscall("read", {fd});
    await writeln(`Read text: '${text}'`);
    
}
