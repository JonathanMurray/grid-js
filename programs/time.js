"use strict";

async function main(args) {
    const now = new Date();
    await syscalls.write([`Current time: ${now.getHours()}:${now.getMinutes()}`]);
}


