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

    const textGrid = new TextGrid(window.canvas);
    
    let shellPid;

    await syscall("handleInterruptSignal");

    try {
        shellPid = await syscall("spawn", {program: "shell", streamIds: [shellStdin, shellStdout],
                                 pgid: "START_NEW"});

        const shellPgid = shellPid; // The shell is process group leader
        await syscall("setForegroundProcessGroupOfPseudoTerminal", {pgid: shellPgid});

        
        window.onresize = (event) => {
            textGrid.resize(event.width, event.height);
        }

        window.onkeydown = (event) => {
            const key = event.key;

            let sequence;
    
            if (event.ctrlKey && key == "c") {
                sequence = ASCII_END_OF_TEXT;
            } else if(event.ctrlKey && key == "d") {
                sequence = ASCII_END_OF_TRANSMISSION;
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
                console.log("Unhandled key in terminal: ", key);
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
                
                let matched;

                if (text[0] == ASCII_BACKSPACE) {
                    if (textGrid.cursorChar > 0) {
                        textGrid.eraseInLine();
                    }
                    matched = 1;
                } else if (text[0] == "\n") {
                    textGrid.lines.push("");
                    textGrid.cursorLine ++;
                    textGrid.cursorChar = 0;
                    matched = 1;
                } else if (text[0] == ASCII_CARRIAGE_RETURN) {
                    textGrid.moveToStartOfLine();
                    matched = 1;
                } else if (text.startsWith(ANSI_CSI)) {

                    let args = [];
                    let numberString = "";
                    let i = ANSI_CSI.length;
                    while(true) {
                        if ("0123456789".includes(text[i])) {
                            numberString += text[i];
                        } else {
                            args.push(Number.parseInt(numberString));
                            numberString = "";
                            if (text[i] != ";") {
                                break;
                            }
                        } 
                        i++;
                    }
                    const ansiFunction = text[i];

                    if (ansiFunction == "C") {
                        if (textGrid.cursorChar < textGrid.lines[textGrid.lines.length - 1].length) {
                            textGrid.cursorChar ++;
                        }
                        matched = i + 1;
                    } else if (ansiFunction == "D") {
                        if (textGrid.cursorChar > 0) {
                            textGrid.cursorChar --;
                        }
                        matched = i + 1;
                    } else if (ansiFunction == "G") {
                        textGrid.moveToColumnIndex(args[0] - 1);
                        matched = i + 1;
                    } else if (ansiFunction == "X") {
                        const commandLen = args[0];
                        let command = text.slice(i + 1, i + 1 + commandLen);
                        command = JSON.parse(command);
                        if ("setTextStyle" in command) {
                            textGrid.setTextStyle(command.setTextStyle);
                        } else if ("setBackgroundStyle" in command) {
                            textGrid.setBackgroundStyle(command.setBackgroundStyle);
                        } else if ("printPrompt" in command){
                            terminal.printPrompt();
                        } else if ("clear" in command) {
                            terminal.clear();
                        } else {
                            console.error("Unhandled terminal command: ", command);
                        }

                        matched = i + 1 + commandLen;
                    } else {
                        assert(false, `Unhandled ansi function: '${ansiFunction}`);
                    }
                } else {
                    textGrid.insertInLine(text[0]);
                    matched = 1;
                } 

                text = text.slice(matched);

                textGrid.draw();
            }
        }
    } catch (error) {

        console.warn(error);

        if (error.name != "ProcessInterrupted") {
            console.warn("Terminal crash: ", error);
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
