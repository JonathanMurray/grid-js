"use strict";

import { writeln } from "/lib/stdlib.mjs";

async function main(args) {
    for (let i = 0; i < 1000000; i++) {
        fib();
    }
}

function fib() {
    let x = 0;
    let y = 1;
    writeln(x.toString());
    writeln(y.toString());
    for (let i = 0; i < 100000; i++) {
        const fn = x + y;
        if (!Number.isFinite(fn)) {
            writeln("done.");
            return;
        }
        writeln(fn.toString());
        x = y;
        y = fn;
    }
}