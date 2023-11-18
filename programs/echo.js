"use strict";

async function main(args) {
    for (let word of args) {
        await writeln(word);
    }
}
