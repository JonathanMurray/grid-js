"use strict";

async function main(args) {
    for (word of args) {
        await writeln(word);
    }
}
