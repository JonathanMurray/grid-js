"use strict";

async function main(args) {

    const window = await stdlib.createWindow("Terminal", [500, 400]);

    // We need to be leader in order to create a PTY
    await syscall("joinNewSessionAndProcessGroup");

    const pty = await syscall("createPseudoTerminal");
    const terminalPtyReader = pty.master.in;
    const terminalPtyWriter = pty.master.out;
    const shellStdin = pty.slave.in;
    const shellStdout = pty.slave.out;

    const canvas = window.canvas;
    const ctx = canvas.getContext("2d");
    
    let cellSize = [14, 22];

    let terminalSize = [Math.floor(canvas.width / cellSize[0]), Math.floor(canvas.height / cellSize[1])];

    let terminalGrid = new TerminalGrid(terminalSize, "black", "white");

    let shellPid;

    await syscall("handleInterruptSignal");

    function draw() {
        ctx.fillStyle = terminalGrid.defaultBackground;;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        terminalGrid.draw(ctx, cellSize);
    }

    try {
        shellPid = await syscall("spawn", {program: "shell", streamIds: [shellStdin, shellStdout],
                                 pgid: "START_NEW"});

        const shellPgid = shellPid; // The shell is process group leader
        await syscall("setForegroundProcessGroupOfPseudoTerminal", {pgid: shellPgid});

        async function recomputeTerminalSize() {
            terminalSize = [Math.floor(canvas.width/ cellSize[0]), Math.floor(canvas.height / cellSize[1])];
            terminalGrid.resize(terminalSize);
            draw();
            await syscall("configurePseudoTerminal", {resize: {width: terminalSize[0], height: terminalSize[1]}});
        }

        async function changeFontSize(modifier) {
            // TODO Careful with float canvas coordinates. Can they cause bad antialiasing effects?
            cellSize = [cellSize[0] * modifier, cellSize[1] * modifier];
            await recomputeTerminalSize();
        }

        window.onresize = (event) => {
            canvas.width = event.width;
            canvas.height = event.height;

            recomputeTerminalSize()
        }

        window.onwheel = (event) => {
            const updated = terminalGrid.scroll(event.deltaY);
            if (updated) {
                draw();
            }
        }

        window.onkeydown = (event) => {
            const key = event.key;
            let sequence;
    
            if (event.ctrlKey && key == "c") {
                sequence = ASCII_END_OF_TEXT;
            } else if(event.ctrlKey && key == "d") {
                sequence = ASCII_END_OF_TRANSMISSION;
            } else if (event.ctrlKey && key == "-") {
                console.log("SMALLER");
                changeFontSize(0.9);
            } else if (event.ctrlKey && key == "+") {
                changeFontSize(1.11);
            } else if (key == "Backspace") {
                sequence = ASCII_BACKSPACE;
            } else if (key == "ArrowUp") {
                sequence = ANSI_CURSOR_UP;
            } else if (key == "ArrowDown") {
                sequence = ANSI_CURSOR_DOWN;
            } else if (key == "ArrowRight") {
                sequence = ANSI_CURSOR_FORWARD;
            } else if (key == "ArrowLeft") {
                sequence = ANSI_CURSOR_BACK;
            } else if (key == "Home") {
                sequence = ASCII_CARRIAGE_RETURN;
            } else if (key == "End") {
                sequence = ANSI_CURSOR_END_OF_LINE;
            } else if (key == "Enter") {
                sequence = "\n";     
            } else if (key == "Shift") {
                sequence = null;
            } else if (key.length > 1) {
                //console.log("Unhandled key in terminal: ", key);
                sequence = null;
            } else {
                sequence = key;
            }
    
            if (sequence != null) {
                write(sequence, terminalPtyWriter);
            }
        };
    
        while (true) {
            let text = await syscall("read", {streamId: terminalPtyReader});

            while (text != "") {
                const unhandledAnsiFunction = terminalGrid.insert(text);

                if (unhandledAnsiFunction == undefined) {
                    text = ""; // All text was handled
                } else {
                    const {ansiFunction, args, consumed, matched} = unhandledAnsiFunction;
                    text = text.slice(consumed);
                    if (ansiFunction == "n") {
                        if (args[0] == 6) {
                            // See ANSI_GET_CURSOR_POSITION
                            const cursorPosition = terminalGrid.cursorPosition();
                            await write(cursorPositionReport(cursorPosition[1] + 1, cursorPosition[0] + 1), terminalPtyWriter);
                        } else {
                            assert(false, "support more ansi 'n' functions");
                        }
                    } else if (ansiFunction == "X") {
                        const commandLen = args[0];
                        let command = text.slice(0, commandLen);
                        command = JSON.parse(command);
                        if ("setTextStyle" in command) {
                            terminalGrid.setDefaultForeground(command.setTextStyle);
                        } else if ("setBackgroundStyle" in command) {
                            terminalGrid.setDefaultBackground(command.setBackgroundStyle);
                        } else {
                            console.error("Unhandled terminal command: ", command);
                        }
    
                        text = text.slice(commandLen);
                    } else {
                        console.error("Unhandled ansi function: ", ansiFunction, args, consumed, matched);
                        return;
                    }
                }
            }

            draw();
        }
    } catch (error) {

        console.warn(error);

        if (error.name != "ProcessInterrupted") {
            console.warn("Terminal crash: ", error);
            debugger;
        }

        if (shellPid != undefined) {
            // The shell is process group leader
            await syscall("sendSignal", {signal: "kill", pgid: shellPid});
        }

        if (error.name != "ProcessInterrupted") {
            throw error;
        }
    }

}
