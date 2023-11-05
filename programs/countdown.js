"use strict";

async function main(args) {

    let counter;
    if (args.length > 0) {
        counter = parseInt(args[0]);
    } else {
        counter = 3;
    }

    while (counter > 0) {
        syscalls.write(["" + counter]);
        counter --;
        await new Promise(r => setTimeout(r, 1000));
    }
}
