"use strict";

class TerminalProg {

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
        if (this.text.cursorChar > TerminalProg.PROMPT.length) {
            this.text.eraseInLine();
        }

        if (this.inputIndex > 0) {
            this.inputBuffer = this.inputBuffer.slice(0, this.inputIndex - 1) + this.inputBuffer.slice(this.inputIndex);
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
        this.appendToLastLine(TerminalProg.PROMPT);
        this.text.cursorChar = TerminalProg.PROMPT.length;
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

    submitLine() {
        this.pushNewLine();

        syscall("write", {output: [this.inputBuffer], streamId: this.shellWriterStreamId});
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
        if (this.text.cursorChar > TerminalProg.PROMPT.length) {
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


    const size = [400, 400];

    await syscall("graphics", {title: "Terminal", size: [size[0] + 30, size[1] + 20]});

    const canvas = document.createElement("canvas");
    canvas.width = size[0];
    canvas.height = size[1];
    canvas.style.outline = "1px solid black";
    document.getElementsByTagName("body")[0].appendChild(canvas);

    const {readerId: shellInputReaderId, writerId: shellInputWriterId} = await syscall("createPipe");
    const {readerId: shellOutputReaderId, writerId: shellOutputWriterId} = await syscall("createPipe");
    const {readerId: commandReaderId, writerId: commandWriterId} = await syscall("createPipe");

    const terminal = new TerminalProg(canvas, shellInputWriterId);

    const shellPid = await syscall("spawn", {program: "shell", streamIds: [shellInputReaderId, shellOutputWriterId, commandWriterId],
        startNewProcessGroup: true});

    window.addEventListener("keydown", function(event) {
        if (event.ctrlKey && event.key == "c") { 
            // This signal should be ignored by the shell itself, but (likely) kill any processes that it has spawned.
            syscall("sendSignal", {signal: "interrupt", pgid: shellPid});
        } 
        
        terminal.handleEvent("keydown", event);
    });

    while (true) {
        const {line, streamId} = await syscall("readAny", {streamIds: [shellOutputReaderId, commandReaderId]});

        if (streamId == shellOutputReaderId) {
            terminal.printOutput([line]);
        } else {
            console.log("TERMINAL RECEIVED COMMAND FROM SHELL: ", line);
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


}

