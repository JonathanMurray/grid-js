"use strict";

class Terminal {

    static PROMPT = "> ";

    constructor(canvas, shellWriterStreamId) {
        this.text = new TextGrid(canvas);
        this.canvas = canvas;

        this.text.setTextStyle("blue");

        this.inputBuffer = "";
        this.inputIndex = 0;

        this.shellWriterStreamId = shellWriterStreamId;
    }

    setTextStyle(style) {
        this.text.setTextStyle(style);
    }

    setBackgroundStyle(style) {
        this.text.setBackgroundStyle(style);
    }

    handleEvent(name, event) {
        if (name == "keydown") {
            const key = event.key;
            if(event.ctrlKey && key == "c") {
                this.ctrlC();
            } else if (key == "Backspace") {
                this.backspace();
            } else if (key == "Enter") {
                this.submitLine();
            } else if (key == "ArrowLeft") {
                this.moveLeft();
            } else if (key == "ArrowRight") {
                this.moveRight();
            } else if (key == "Home") {
                this.moveToStartOfLine();
            } else if (key == "End") {
                this.moveToEndOfLine();
            } else if (key.length == 1) {
                this.insertKey(key);
            }

            this.text.draw();
        }
    }

    insertKey(key) {
        this.text.insertCharInLine(key);
        
        this.inputBuffer = this.inputBuffer.slice(0, this.inputIndex) + key + this.inputBuffer.slice(this.inputIndex);
        this.inputIndex ++;
    }

    backspace() {
        if (this.text.cursorChar > Terminal.PROMPT.length) {
            this.text.eraseInLine();
        }

        if (this.inputIndex > 0) {
            this.inputBuffer = this.inputBuffer.slice(0, this.inputIndex - 1) + this.inputBuffer.slice(this.inputIndex);
            this.inputIndex --;
        }
    }

    printOutput(output) {
        for (let line of output) {
            this.appendToLastLine(line);
            this.pushNewLine();
        }
        this.text.cursorChar = this.text.lines[this.text.lines.length - 1].length;
        this.text.draw();
    }

    appendToLastLine(str) {
        this.text.lines[this.text.lines.length - 1] = this.text.lines[this.text.lines.length - 1] + str;   
    }

    printPrompt() {
        this.appendToLastLine(Terminal.PROMPT);
        this.text.cursorChar = Terminal.PROMPT.length;
        this.text.draw();
    }

    pushNewLine() {
        this.text.lines.push("");
        this.text.cursorLine ++;
        this.text.cursorChar = 0;
    }

    ctrlC() {
        this.printOutput(["^C"])
        this.printPrompt();

        this.inputBuffer = "";
        this.inputIndex = 0;
    }

    async submitLine() {
        this.pushNewLine();
        await writeln(this.inputBuffer, this.shellWriterStreamId);
        this.inputBuffer = "";
        this.inputIndex = 0;
    }

    moveRight() {
        if (this.text.cursorChar < this.text.lines[this.text.lines.length - 1].length) {
            this.text.cursorChar ++;
        }

        this.inputIndex = Math.min(this.inputIndex + 1, this.inputBuffer.length - 1);
    }

    moveLeft() {
        if (this.text.cursorChar > Terminal.PROMPT.length) {
            this.text.cursorChar --;
        }

        this.inputIndex = Math.max(this.inputIndex - 1, 0);
    }

    moveToStartOfLine() {
        // TODO: account for prompt
        this.text.moveToStartOfLine();

        this.inputIndex = 0;
    }

    moveToEndOfLine() {
        this.text.moveToEndOfLine();

        this.inputIndex = this.inputBuffer.length - 1;
    }

}


async function main(args) {


    const size = [500, 400];

    await syscall("graphics", {title: "Terminal", size: [size[0] + 30, size[1] + 20]});

    const canvas = document.createElement("canvas");
    canvas.width = size[0];
    canvas.height = size[1];
    canvas.style.outline = "1px solid black";
    document.getElementsByTagName("body")[0].appendChild(canvas);

    // We need to be leader in order to create a PTY
    await syscall("joinNewSessionAndProcessGroup");

    const {masterReaderId: terminalPtyReader, masterWriterId: terminalPtyWriter, slaveReaderId: shellReader, slaveWriterId: shellWriter} = 
        await syscall("createPseudoTerminal");

    // The shell sends commands to the terminal over this pipe
    const {readerId: commandReaderId, writerId: commandWriterId} = await syscall("createPipe");

    const terminal = new Terminal(canvas, terminalPtyWriter);
    
    let shellPid;

    syscall("handleInterruptSignal");

    try {
        shellPid = await syscall("spawn", {program: "shell", streamIds: [shellReader, shellWriter, commandWriterId],
        startNewProcessGroup: true});

        const shellPgid = shellPid; // The shell is process group leader
        await syscall("setForegroundProcessGroupOfPseudoTerminal", {pgid: shellPgid});

        window.addEventListener("keydown", function(event) {
            if (event.ctrlKey && event.key == "c") { 
                const pgid = shellPid; // The shell is process group leader
                syscall("getForegroundProcessGroupOfPseudoTerminal").then((pgid) => {
                    syscall("sendSignal", {signal: "interrupt", pgid});
                })
            } 

            terminal.handleEvent("keydown", event);
        });

        while (true) {
            const {line, streamId} = await syscall("readAny", {streamIds: [terminalPtyReader, commandReaderId]});

            if (streamId == terminalPtyReader) {
                terminal.printOutput([line]);
            } else {
                command = JSON.parse(line);
                if ("setTextStyle" in command) {
                    terminal.setTextStyle(command.setTextStyle);
                } else if ("setBackgroundStyle" in command) {
                    terminal.setBackgroundStyle(command.setBackgroundStyle);
                } else if ("printPrompt" in command){
                    terminal.printPrompt();
                } else {
                    console.error("Unhandled terminal command: ", command);
                }
            }

        }
    } catch (error) {
        console.log("KILLING SHELL...");

        // TODO: Rather than sending a kill to the shell's process group, we should send a hangup (https://www.gnu.org/software/libc/manual/html_node/Termination-Signals.html#index-SIGHUP)
        // to the entire session that's associated with the PTY. That should cause all the processes associated with the terminal to exit, rather than just the shell.

        // https://man7.org/linux/man-pages/man2/setsid.2.html
        // https://stackoverflow.com/a/55013260
        // OR RATHER; when the shell process exits, this should trigger the kernel to send HUP to the PTY's foreground process group

        if (shellPid != undefined) {
            // The shell is process group leader
            await syscall("sendSignal", {signal: "kill", pgid: shellPid});
        }
        console.log("SHUTTING DOWN TERMINAL.")

        if (error.name != "ProcessInterrupted") {
            throw error;
        }
    }

}

