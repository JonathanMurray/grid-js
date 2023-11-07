"use strict";

async function main(args) {
    const now = new Date();
    await writeln(`Current time: ${now.getHours()}:${now.getMinutes()}`);
}


