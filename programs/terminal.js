"use strict";

import { reportCrash } from "/lib/errors.mjs";
import { Container, Expand, getEvents, init, redraw } from "/lib/gui.mjs";
import { writeln, write, createWindow } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";
import { TerminalGrid } from "/lib/terminal-grid.mjs";
import { assert, ASCII_END_OF_TEXT, ASCII_END_OF_TRANSMISSION, ASCII_BACKSPACE, ANSI_CURSOR_UP, ANSI_CURSOR_DOWN, ANSI_CURSOR_FORWARD, ANSI_CURSOR_BACK, ASCII_CARRIAGE_RETURN, ANSI_CURSOR_END_OF_LINE, cursorPositionReport } from "/shared.mjs";

async function main(args) {

    const childProgramPath = args[0] || "/bin/shell";

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


    const {socketFd: graphicsFd, canvas} = await createWindow("Terminal", [700, 400], {menubarItems, resizable: true});

    // We need to be leader in order to create a PTY
    await syscall("joinNewSessionAndProcessGroup");

    const terminalGrid = new TerminalGrid([canvas.width, canvas.height], "black", "white", [10, 20]);
    const rootContainer = new Container({bg: "black", padding: 2, expand: Expand.YES});
    rootContainer.addChild(terminalGrid);

    const ptyMaster = await syscall("openFile", {path: "/dev/ptmx"});
    const slaveNumber = await syscall("controlDevice", {fd: ptyMaster, request: {getSlaveNumber: null}});
    const ptySlave = await syscall("openFile", {path: `/dev/pts/${slaveNumber}`});

    await syscall("controlDevice", {fd: ptyMaster, request: {resize: {width: terminalGrid.numColumns, height: terminalGrid.numRows}}});

    let childPid;

    await syscall("handleInterruptSignal");

    await init(rootContainer, graphicsFd, canvas);

    try {
        childPid = await syscall("spawn", {programPath: childProgramPath, fds: [ptySlave, ptySlave],
                                 pgid: "START_NEW"});

        await syscall("close", {fd: ptySlave});

        const childPgid = childPid; // The child is process group leader
        await syscall("controlDevice", {fd: ptyMaster, request: {setForegroundPgid: childPgid}});

        while (true) {
            const readyFd = await syscall("pollRead", {fds: [graphicsFd, ptyMaster]});
            if (readyFd == graphicsFd) {
                for await (const {name, event} of getEvents()) {
                    await handleGuiEvent({name, event});
                }
                continue;
            }

            let text = await syscall("read", {fd: ptyMaster});

            if (text == "") {
                // EOF from the PTY. We have to check if it's caused by the child exiting.
                try {
                    const childExitValue = await syscall("waitForExit", {pid: childPid, nonBlocking: true});
                    terminalGrid.insert(`Child exited with: ${childExitValue}\n`);
                    break;
                } catch (e) {
                    if (e["name"] == "WaitError") {
                        for await (const line of reportCrash(childPid, childProgramPath, e["exitError"])) {
                            terminalGrid.insert(line + "\n");
                        }
                        break;
                    }
                    if (e["errno"] != "WOULDBLOCK") {
                        throw e;
                    }
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
                            await write(cursorPositionReport(rowIdx + 1, colIdx + 1), ptyMaster);
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
                    }
                }
            }
            
            await redraw();
        }

        terminalGrid.insert("\nThe child process has shut down. This terminal can't be used anymore.");
        await redraw();

        while (true) {
            await syscall("sleep", {millis: 60000});
        }

    } catch (error) {

        console.warn(error);

        if (error["name"] != "ProcessInterrupted") {
            console.warn("Terminal crash: ", error);
            debugger;
        }

        if (childPid != undefined) {
            // The child is process group leader
            await syscall("sendSignalToProcessGroup", {signal: "kill", pgid: childPid});
        }

        if (error["name"] != "ProcessInterrupted") {
            throw error;
        }
    } finally {
        console.log("Terminal shutting down");
    }
    
    async function changeFontSize(modifier) {
        // TODO Careful with float canvas coordinates. Can they cause bad antialiasing effects?
        terminalGrid.setCellSize([terminalGrid.cellSize[0] * modifier, terminalGrid.cellSize[1] * modifier]);
        await redraw();
        await syscall("controlDevice", {fd: ptyMaster, request: {resize: {width: terminalGrid.numColumns, height: terminalGrid.numRows}}});
    }

    async function onwindowWasResized(event) {
        canvas.width = event.width;
        canvas.height = event.height;

        await redraw();
        await syscall("controlDevice", {fd: ptyMaster, request: {resize: {width: terminalGrid.numColumns, height: terminalGrid.numRows}}});
        await write(JSON.stringify({resizeDone: null}), graphicsFd);
    };

    async function oncloseWasClicked(event) {
        await writeln("Terminal shutting down. (Window was closed.)");
        await syscall("exit");
    };

    function onmenubarButtonWasClicked({buttonId}) {
        if (buttonId == "ZOOM_IN") {
            changeFontSize(1.11);
        } else {
            assert(buttonId == "ZOOM_OUT");
            changeFontSize(0.9);
        }
    };
    
    async function onmenubarDropdownItemWasClicked({itemId}) {
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
        await redraw();
    };

    async function handleGuiEvent({name, event}) {
        if (name == "keydown") {
            await onkeydown(event);
        } else if (name == "menubarDropdownItemWasClicked") {
            await onmenubarDropdownItemWasClicked(event);
        } else if (name =="windowWasResized") {
            await onwindowWasResized(event);
        } else if (name =="closeWasClicked") {
            await oncloseWasClicked(event);
        } else if (name =="menubarButtonWasClicked") {
            onmenubarButtonWasClicked(event);
        } else if (name == "mousedown") {
            console.log("TODO mousedown", event);
        }
    }

    async function onkeydown(event) {

        const key = event.key;
        let sequence;

        if (event.ctrlKey && key == "c") {
            sequence = ASCII_END_OF_TEXT;
        } else if(event.ctrlKey && key == "d") {
            sequence = ASCII_END_OF_TRANSMISSION;
        } else if (event.ctrlKey && key == "-") {
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
            await write(sequence, ptyMaster);
        }
    };




}
