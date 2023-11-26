"use strict";

async function main(args) {
    try {
        
        if (args.length >= 1) {
            const fileName = args[0];
            await run(fileName);
        } else {
            await writeError("missing filename argument");
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

    let lineWidth;
    let rows;
    let lineToRowMapping;
    let inputBuffer = "";

    let termsize = await syscall("getTerminalSize");

    async function init() {
        lineWidth = termsize[0] - leftMargin;
        let lineBeginnings;
        ({rows, lineBeginnings} = doc.calculateWrapped(lineWidth));

        let lineNumber = 1;
        lineToRowMapping = {};
        for (let rowIndx of lineBeginnings) {
            lineToRowMapping[lineNumber] = rowIndx;
            lineNumber ++;
        }
    }

    async function onresize() {
        termsize = await syscall("getTerminalSize");
        await init();
        await render();
    }

    handleTerminalResizeSignal(onresize);

    let offset = 0;

    async function render() {
        let output = ANSI_ERASE_ENTIRE_SCREEN;
        let lineNumber = 1;
        for (let i = 0; i < rows.length; i++) {

            const lineBeginning = lineToRowMapping[lineNumber] == i;

            if (i >= offset) {
                if (lineBeginning) {
                    output +=  `${ANSI_CSI}36;44m${lineNumber.toString().padStart(lineNumberWidth)}${ANSI_CSI}39;49m `;
                } else {
                    output += `${ANSI_CSI}44m${"".padStart(lineNumberWidth)}${ANSI_CSI}49m `;
                }
                output += rows[i].padEnd(lineWidth)
            }

            if (i - offset == termsize[1] - 2) {
                break;
            }

            if (lineBeginning) {
                lineNumber ++;
            }
        }

        // Make sure input buffer is shown at the very bottom, even for short files.
        for (let i = 0; i < termsize[1] - rows.length; i++) {
            output += "\n";
        }

        output += `:${inputBuffer}`;
        await write(output);
    }

    function setOffset(value) {
        offset = Math.max(0, Math.min(value, rows.length - termsize[1]));
    }

    await init();

    while (true) {
        await render();
        const input = await read();

        let isNumber = /^\d+$/.test(input);
        if (isNumber) {
            inputBuffer += input;
        } else {

            const lineNumber = Number.parseInt(inputBuffer);
            
            if ([ANSI_CURSOR_UP, "k"].includes(input)) {
                const delta = lineNumber >= 1 ? lineNumber : 1;
                setOffset(offset - delta);
            } else if ([ANSI_CURSOR_DOWN, "j"].includes(input)) {
                const delta = lineNumber >= 1 ? lineNumber : 1;
                setOffset(offset + delta);
            } else if (input == "g") {
                if (lineNumber >= 1) {
                    setOffset(lineToRowMapping[lineNumber]);
                } else {
                    setOffset(0);
                }
            } else if (input == "G") {
                if (lineNumber >= 1) {
                    setOffset(lineToRowMapping[lineNumber]);
                } else {
                    setOffset(rows.length - 1);
                }
            } else if (input == "q") {
                // Exit program
                break;
            } else {
                console.log("TODO: handle input: ", input);
            }
            inputBuffer = "";
        }
   
    }
}
