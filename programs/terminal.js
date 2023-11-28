"use strict";

async function main(args) {

    const programName = args[0] || "shell";

    const menubarItems = [
        {
            text: "Theme",
            dropdown: [
                {
                    text: "Dark",
                    id: "DARK"
                },
                {
                    text: "Light",
                    id: "LIGHT"
                },
                {
                    text: "Matrix",
                    id: "MATRIX"
                },
            ]
        },
        {
            text: "Font -",
            id: "ZOOM_OUT",
        },
        {
            text: "Font +",
            id: "ZOOM_IN",
        },
    ]


    const window = await stdlib.createWindow("Terminal", [500, 400], {menubarItems});

    // We need to be leader in order to create a PTY
    await syscall("joinNewSessionAndProcessGroup");

    const canvas = window.canvas;
    const ctx = canvas.getContext("2d");
    
    let cellSize = [10, 20];

    let terminalSize = [Math.floor(canvas.width / cellSize[0]), Math.floor(canvas.height / cellSize[1])];

    let terminalGrid = new TerminalGrid(terminalSize, "black", "white");

    const pty = await syscall("createPseudoTerminal");
    await syscall("configurePseudoTerminal", {resize: {width: terminalSize[0], height: terminalSize[1]}});
    const terminalPtyReader = pty.master.in;
    const terminalPtyWriter = pty.master.out;
    const childStdin = pty.slave.in;
    const childStdout = pty.slave.out;

    let childPid;
    let hasChildExited = false;

    await syscall("handleInterruptSignal");

    function draw() {
        ctx.fillStyle = terminalGrid.defaultBackground;;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        terminalGrid.draw(ctx, cellSize);
    }

    draw();

    try {
        childPid = await syscall("spawn", {program: programName, streamIds: [childStdin, childStdout],
                                 pgid: "START_NEW"});

        await syscall("closeStream", {streamId: childStdin});
        await syscall("closeStream", {streamId: childStdout});

        const childPgid = childPid; // The child is process group leader
        await syscall("setForegroundProcessGroupOfPseudoTerminal", {pgid: childPgid});

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

        window.onclose = async (event) => {
            await writeln("Terminal shutting down. (Window was closed.)");
            await syscall("exit");
        }

        window.onwheel = (event) => {
            const updated = terminalGrid.scroll(event.deltaY);
            if (updated) {
                draw();
            }
        }

        window.onbutton = ({buttonId}) => {
            if (buttonId == "ZOOM_IN") {
                changeFontSize(1.11);
            } else {
                assert(buttonId == "ZOOM_OUT");
                changeFontSize(0.9);
            }
        }
        window.ondropdown = ({itemId}) => {
            console.log(itemId);
            if (itemId == "DARK") {
                terminalGrid.setDefaultBackground("black");
                terminalGrid.setDefaultForeground("white");
            } else if (itemId == "LIGHT") {
                terminalGrid.setDefaultBackground("white");
                terminalGrid.setDefaultForeground("black");
            } else if (itemId == "MATRIX") {
                terminalGrid.setDefaultBackground("black");
                terminalGrid.setDefaultForeground("#00FF00");
            } else {
                assert(false);
            }
            draw();
        }

        window.onkeydown = (event) => {

            if (hasChildExited) {
                return;
            }

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

            if (text == "") {
                // EOF from the PTY. We have to check if it's caused by the child exiting.
                try {
                    await syscall("waitForExit", {pid: childPid, nonBlocking: true});
                    hasChildExited = true;
                    break;
                } catch (e) {
                    if (e.errno != "WOULDBLOCK") {
                        throw e;
                    }
                    debugger;
                }
            }

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
                            const [colIdx, rowIdx] = terminalGrid.cursorPosition();
                            await write(cursorPositionReport(rowIdx + 1, colIdx + 1), terminalPtyWriter);
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
                        console.error("Unhandled ansi function: ", ansiFunction, `(\\x${ansiFunction.codePointAt(0).toString(16)})`, args, consumed, matched);
                        return;
                    }
                }
            }

            draw();
        }

        terminalGrid.insert("\nThe child process has shut down. This terminal can't be used anymore.");
        draw();

        while (true) {
            await syscall("sleep", {millis: 60000});
        }

    } catch (error) {

        console.warn(error);

        if (error.name != "ProcessInterrupted") {
            console.warn("Terminal crash: ", error);
            debugger;
        }

        if (childPid != undefined) {
            // The child is process group leader
            await syscall("sendSignal", {signal: "kill", pgid: childPid});
        }

        if (error.name != "ProcessInterrupted") {
            throw error;
        }
    } finally {
        console.log("Terminal shutting down");
    }

}
