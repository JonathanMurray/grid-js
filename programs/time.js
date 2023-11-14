"use strict";

async function main(args) {
    const now = new Date();
    await writeln(`${now.toLocaleTimeString("sv-SE")}`);
}


