"use strict";

class Terminal {
    static PROMPT = "> ";

    constructor(canvas, system) {
        this.text = new TextGrid(canvas);
        this.system = system;
        this.canvas = canvas;

        this.text.setTextStyle("blue");

        this.inputBuffer = "";
        this.inputIndex = 0;
    }

    setTextStyle(style) {
        this.text.setTextStyle(style);
    }

    setBackgroundStyle(style) {
        this.text.setBackgroundStyle(style);
    }

    setFocused(focused) {
        this.text.setFocused(focused);
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

    submitLine() {
        this.pushNewLine();
        this.system.handleInput(this.inputBuffer);
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
