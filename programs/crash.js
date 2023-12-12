"use strict";

import { syscall } from "/lib/sys.mjs";

async function main(args) {
    await inner();
}

async function inner() {
    await syscall("write", {text: "hey", whatIsThis: 1});
}