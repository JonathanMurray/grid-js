"use strict";

import { read, writeln } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";

async function main(args) {

    const fd = await syscall("openFile", {filePath: "/dev/pipe"});
    await writeln(`opened file: ${fd}`);

    let text = await writeln("hello", fd);
    await writeln(`wrote text`);

    text = await read(fd);
    await writeln(`Read text: '${text}'`);
    
}
