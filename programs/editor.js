"use strict";

class Editor {

    constructor(canvas, fileName, lines) {
        this.text = new TextGrid(canvas);
        this.canvas = canvas;

        if (lines != null) {
            this.text.lines = lines.map(x => x);
        }
      
        this.fileName = fileName;

        this.text.draw();
    }

    async saveToFile() {
        const streamId = await syscall("openFile", {fileName: this.fileName});
        const text = this.text.lines.join("\n");
        await syscall("write", {streamId, text});
        await syscall("setFileLength", {streamId, length: text.length});
        await syscall("closeStream", {streamId});
        await writeln(`Saved to ${this.fileName}`);
    }

    handleEvent(name, event) {
        if (name == "keydown") {
            const key = event.key;
            if (key == "s" && event.ctrlKey) {
                this.saveToFile();
            } else if (key == "Backspace") {
                this.backspace();
            } else if (key == "Enter") {
                this.enter();
            } else if (key == "ArrowLeft") {
                this.left();
            } else if (key == "ArrowRight") {
                this.right();
            } else if (key == "ArrowUp") {
                this.up();
            } else if (key == "ArrowDown") {
                this.down();
            } else if (key == "Home") {
                this.home();
            } else if (key == "End") {
                this.end();
            } else if (key.length == 1) {
                this.visibleKey(key);
            }

            this.text.draw();
        }
    }

    visibleKey(key) {
        this.text.insertCharInLine(key);
    }

    backspace() {
        if (this.text.cursorChar > 0) {
            this.text.eraseInLine();
        } else if (this.text.cursorLine > 0) {
            this.text.cursorLine --;
            this.text.cursorChar = this.text.lines[this.text.cursorLine].length;
            this.text.lines[this.text.cursorLine] = (this.text.lines[this.text.cursorLine] + 
                                                            this.text.lines[this.text.cursorLine + 1]);
            this.text.lines.splice(this.text.cursorLine + 1, 1);
        }
    }

    enter() {
        const lineIdx = this.text.cursorLine;
        const charIdx = this.text.cursorChar;
        this.text.lines = (this.text.lines.slice(0, lineIdx).concat(
                        [this.text.lines[lineIdx].slice(0, charIdx)]).concat( 
                            [this.text.lines[lineIdx].slice(charIdx)]).concat(
                                this.text.lines.slice(lineIdx + 1)));
        this.text.cursorLine ++;
        this.text.cursorChar = 0;
    }

    right() {
        if (this.text.cursorChar < this.text.lines[this.text.cursorLine].length) {
            this.text.cursorChar ++;
        } else if (this.text.cursorLine < this.text.lines.length - 1) {
            this.text.cursorLine ++;
            this.text.cursorChar = 0;
        }
    }

    left() {
        if (this.text.cursorChar > 0) {
            this.text.cursorChar --;
        } else if (this.text.cursorLine > 0) {
            this.text.cursorLine --;
            this.text.cursorChar = this.text.lines[this.text.cursorLine].length;
        }
    }

    up() {
        if (this.text.cursorLine > 0) {
            this.text.cursorLine --;
            // Maintain the hor. cursor position, as much as possible
            this.text.cursorChar = Math.min(this.text.lines[this.text.cursorLine].length, this.text.cursorChar);
        } else {
            this.text.moveToStartOfLine();
        }
    }

    down() {
        if (this.text.cursorLine < this.text.lines.length - 1) {
            this.text.cursorLine ++;
            // Maintain the hor. cursor position, as much as possible
            this.text.cursorChar = Math.min(this.text.lines[this.text.cursorLine].length, this.text.cursorChar);
        } else {
            this.text.moveToEndOfLine();
        }
    }

    home() {
        this.text.moveToStartOfLine();
    }

    end() {
        this.text.moveToEndOfLine();
    }
}


async function main(args) {

    let resolvePromise;
    let programDonePromise = new Promise((r) => {resolvePromise = r;});

    let fileName;
    if (args.length > 0) {
        fileName = args[0];
    } else {
        fileName = "tmp";
    }

    const size = [800, 600];
    const window = await stdlib.createWindow("Editing: " + fileName, size);

    const streamId = await syscall("openFile", {fileName, createIfNecessary: true});
    const text = await syscall("read", {streamId});
    const lines = text.split("\n");
    await syscall("closeStream", {streamId});

    
    const app = new Editor(window.canvas, fileName, lines);

    window.onkeydown = (event) => {
        if (event.ctrlKey && event.key == "c") { 
            writeln("Editor shutting down").finally(resolvePromise);
        } else {
            app.handleEvent("keydown", event);
        }
    };

    return programDonePromise;
}

