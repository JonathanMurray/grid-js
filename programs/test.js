"use strict";

async function run() {
    while (true) {
        const line = await readln();
        await writeln("You wrote: " + line);
    }
}

async function main(args) {

    await syscall("handleInterruptSignal");

    try {
        while (true) {
            const line = await readln();
            await writeln("You wrote: " + line);
        }
    } catch (error) {
        if (error.name == "ProcessInterrupted") {
            await writeln("Interrupted. Shutting down.");
        } else {
            throw error;
        }
    }
}
