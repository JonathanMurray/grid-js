"use strict";

async function main(args) {

    let counter;
    if (args.length > 0) {
        counter = parseInt(args[0]);
    } else {
        counter = 3;
    }
    
    while (counter > 0) {
        await write(`${counter} `);
        counter --;
        for (let i = 0; i < 10; i++) {
            await syscall("sleep", {millis: 100});
            await write(".");
        }
        await writeln("");
    }
}
