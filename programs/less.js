"use strict";

async function main(args) {
    try {
        
        if (args.length >= 1) {
            const fileName = args[0];
            await run(fileName);
        } else {
            await writeln("<missing filename argument>")
        }
    } catch (error) {
        if (error.name != "ProcessInterrupted") {
            throw error;
        }
    } finally {
        await stdlib.terminal.exitAlternateScreen();
    }
}

async function run(fileName) {
    
    const streamId = await syscall("openFile", {fileName});
    const text = await syscall("read", {streamId});
    const lines = text.split(/\n|\r\n/);
    const doc = new DocumentWithCursor(lines);
        
    let lineNumberWidth = doc.lines.length.toString().length;
    const leftMargin = lineNumberWidth + 1;

    await syscall("handleInterruptSignal");
    await syscall("configurePseudoTerminal", {mode: "CHARACTER_AND_SIGINT"});
    await stdlib.terminal.enterAlternateScreen();

    let termsize;
    let lineWidth;
    let rows;
    let lineBeginnings;

    await write(ansiCursorPosition(999, 999));
    await write(ANSI_GET_CURSOR_POSITION);
    const cursorPositionResponse = await read();
    const cursorPos = parseCursorPositionResponse(cursorPositionResponse);

    termsize = [cursorPos[1], cursorPos[0]];

    async function init() {
        lineWidth = termsize[0] - leftMargin;
        ({rows, lineBeginnings} = doc.calculateWrapped(lineWidth));
    }

    async function onresize() {
        console.log("ON RESIZE");

        termsize = await syscall("getTerminalSize");
        console.log("TERM SIZE: ", termsize);
        await init();
        console.log("INITED");
        await render();
        console.log("RENDERED");
    }

    handleTerminalResizeSignal(onresize);

    let offset = 0;

    async function render() {
        let output = ANSI_ERASE_ENTIRE_SCREEN;
        let lineNumber = 0;
        for (let i = 0; i < rows.length; i++) {

            if (lineBeginnings.includes(i)) {
                lineNumber ++;
            }

            if (i >= offset) {
                if (lineBeginnings.includes(i)) {
                    output += lineNumber.toString().padStart(lineNumberWidth) + " ";
                } else {
                    output += "".padStart(lineNumberWidth + 1);
                }
                output += rows[i].padEnd(lineWidth)
            }

        }
        output += ansiCursorPosition(termsize[1], termsize[0]);
        await write(output);
    }

    await init();

    while (true) {
        await render();
        const input = await read();

        const scrollSpeed = 1;
        if (input == ANSI_CURSOR_UP) {
            offset = Math.max(offset - scrollSpeed, 0);
        } else if (input == ANSI_CURSOR_DOWN) {
            offset = Math.max(0, Math.min(offset + scrollSpeed, rows.length - termsize[1]));
        } else {
            console.log("TODO: handle input: ", input);
        }
    }
}

function parseCursorPositionResponse(response) {
    const responseRegex = /\x1B\[(.+);(.+)R/;
    const responseMatch = response.match(responseRegex);
    const line = Number.parseInt(responseMatch[1]);
    const col = Number.parseInt(responseMatch[2]);
    assert(Number.isInteger(line) && Number.isInteger(col), "Invalid cursor position response: " + response);
    return [line, col];
}