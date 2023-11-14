"use strict";

async function main(args) {
    await inner();
}

async function inner() {
    await syscall("write", {text: "hey", whatIsThis: 1});
}