"use strict";

import { writeln } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";

async function main(args) {

    const fd = await syscall("openFile", {filePath: "textfile"});
    await writeln(`opened file: ${fd}`);

    let text = await syscall("read", {fd});
    await writeln(`Read text: '${text}'`);

    text = await syscall("read", {fd});
    await writeln(`Read text: '${text}'`);
    
}
