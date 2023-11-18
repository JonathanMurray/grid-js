"use strict";

const EOT = "\x04";

class Terminal {

    static PROMPT = "> ";

    constructor(canvas, shellWriterStreamId) {
        this.text = new TextGrid(canvas);
        this.canvas = canvas;
        this.inputBuffer = "";
        this.inputIndex = 0;
        this.shellWriterStreamId = shellWriterStreamId;

        this.text.setTextStyle("blue");
    }

    resize(w, h) {
        this.text.resize(w, h);
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
            } else if(event.ctrlKey && key == "d") {
                this.ctrlD();  
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

    printOutput(text) {
        let newlineIndex = text.indexOf("\n");
        while (newlineIndex >= 0) {
            let line = text.slice(0, newlineIndex);
            this.appendToLastLine(line);
            this.pushNewLine();
            text = text.slice(newlineIndex + 1);
            newlineIndex = text.indexOf("\n");
        }
        this.appendToLastLine(text);
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
        this.printOutput("^C\n");
        this.printPrompt();

        this.inputBuffer = "";
        this.inputIndex = 0;
    }

    async ctrlD() {
        this.printOutput("^D\n");
        await write(EOT, this.shellWriterStreamId);
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
        this.text.cursorChar = Terminal.PROMPT.length;
        this.inputIndex = 0;
    }

    moveToEndOfLine() {
        this.text.moveToEndOfLine();
        this.inputIndex = this.inputBuffer.length - 1;
    }

    clear() {
        this.inputBuffer = "";
        this.inputIndex = 0;
        this.text.clear();
    }

}


async function main(args) {

    const window = await stdlib.createWindow("Terminal", [500, 400]);

    // We need to be leader in order to create a PTY
    await syscall("joinNewSessionAndProcessGroup");

    const {masterReaderId: terminalPtyReader, masterWriterId: terminalPtyWriter, slaveReaderId: shellReader, slaveWriterId: shellWriter} = 
        await syscall("createPseudoTerminal");

    const terminal = new Terminal(window.canvas, terminalPtyWriter);
    
    let shellPid;

    await syscall("handleInterruptSignal");

    try {
        shellPid = await syscall("spawn", {program: "shell", streamIds: [shellReader, shellWriter],
                                 pgid: "START_NEW"});

        const shellPgid = shellPid; // The shell is process group leader
        await syscall("setForegroundProcessGroupOfPseudoTerminal", {pgid: shellPgid});

        window.onkeydown = (event) => {
            if (event.ctrlKey && event.key == "c") { 
                const pgid = shellPid; // The shell is process group leader
                syscall("getForegroundProcessGroupOfPseudoTerminal").then((pgid) => {
                    syscall("sendSignal", {signal: "interrupt", pgid});
                })
            } 

            terminal.handleEvent("keydown", event);
        };

        window.onresize = (event) => {
            terminal.resize(event.width, event.height);
        }
    
        while (true) {
            let text = await syscall("read", {streamId: terminalPtyReader});

            let escapeIndex = text.indexOf("\x1B");
            while (escapeIndex >= 0) {
                const before = text.slice(0, escapeIndex);
                terminal.printOutput(before);
                
                const commandLen = text.slice(escapeIndex + 1, escapeIndex + 2).charCodeAt(0);
                let command = text.slice(escapeIndex + 2, escapeIndex + 2 + commandLen);
                command = JSON.parse(command);
                if ("setTextStyle" in command) {
                    terminal.setTextStyle(command.setTextStyle);
                } else if ("setBackgroundStyle" in command) {
                    terminal.setBackgroundStyle(command.setBackgroundStyle);
                } else if ("printPrompt" in command){
                    terminal.printPrompt();
                } else if ("clear" in command) {
                    terminal.clear();
                } else {
                    console.error("Unhandled terminal command: ", command);
                }

                text = text.slice(escapeIndex + 2 + commandLen);
                escapeIndex = text.indexOf("\x1B");
            } 
           
            terminal.printOutput(text);
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
