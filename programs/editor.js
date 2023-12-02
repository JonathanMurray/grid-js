"use strict";

class Editor {

    constructor(canvas, fileName, lines) {
        this._cellSize = [9, 16];
        this._gridSize = [Math.floor(canvas.width / this._cellSize[0]), Math.floor(canvas.height / this._cellSize[1])];

        this._canvas = canvas;
        this._ctx = canvas.getContext("2d");

        this._doc = new DocumentWithCursor(lines);
        
        this._yOffset = 0;
        this._doc.cursorLine = 0;

        this.fileName = fileName;

        this._hasUnsavedChanges = false;

        this._update();
    }

    async saveToFile() {
        const fd = await syscall("openFile", {fileName: this.fileName});
        const text = this._doc.lines.join("\n");
        await syscall("write", {fd, text});
        await syscall("setFileLength", {fd, length: text.length});
        await syscall("close", {fd});
        this._hasUnsavedChanges = false;
        this._update();
    }

    resize(w, h) {

        this._canvas.width = w;
        this._canvas.height = h;
        this._gridSize = [Math.floor(w / this._cellSize[0]), Math.floor(h / this._cellSize[1])];

        this._update();
    }

    _background(color, cell) {
        this._ctx.fillStyle = color;
        Grid.fillCell(this._ctx, this._cellSize, cell);
    }

    _char(char, cell) {
        assert(char.length == 1);
        this._ctx.fillStyle = "black";
        Grid.characterCell(this._ctx, this._cellSize, cell, char, {});
    }

    _update() {

        let lineNumberWidth = this._doc.lines.length.toString().length;
        const leftMargin = lineNumberWidth + 1;

        const topMargin = 1;

        this._ctx.fillStyle = "white";
        this._ctx.fillRect(0, 0, this._canvas.width, this._canvas.height);

        const rowWidth = this._gridSize[0] - leftMargin;
        const {rows, cursorRow, cursorCol, lineBeginnings} = this._doc.calculateWrapped(rowWidth);

        const showDocRows =  this._gridSize[1] - topMargin;
        if (cursorRow < this._yOffset) {
            this._yOffset = cursorRow;
        } else if (cursorRow > this._yOffset + showDocRows - 1) {
            this._yOffset = cursorRow - showDocRows + 1;
        }
        
        const statusLines = [`${this.fileName} ${this._hasUnsavedChanges ? "~" : ""}`, ""];
        const statusMargin = leftMargin + 1;
        for (let y = 0; y < topMargin; y++) {
            for (let x = 0; x < this._gridSize[0]; x++) {
                if (x > leftMargin - 1) {
                    this._background("lightgreen", [x, y]);
                }
            }
            for (let x = 0; x < this._gridSize[0]; x++) {
                if (x < statusLines[y].length) {
                    this._char(statusLines[y][x], [statusMargin + x, y]);
                } 
            }
        }
        
        this._background("salmon", [cursorCol + leftMargin, topMargin + cursorRow - this._yOffset]);

        let gridY = topMargin;
        let lineNumber = 0;
        for (let docY = 0; docY < rows.length; docY ++) {

            if (lineBeginnings.includes(docY)) {
                lineNumber ++;
            }

            if (docY >= this._yOffset) {
                for (let i = 0; i < leftMargin; i++) {
                    this._background("lightblue", [i, gridY]);
                }
                let numberString;
                if (lineBeginnings.includes(docY)) {
                    numberString = lineNumber.toString();
                } else {
                    numberString = "";
                }
                numberString = numberString.padStart(lineNumberWidth)
                for (let i = 0; i < lineNumberWidth && i < numberString.length; i++) {
                    this._char(numberString[i], [i, gridY]);
                }
                for (let x = 0; x < rowWidth; x ++) {
                    const ch = rows[docY][x];
                    if (ch) {
                        this._char(ch, [leftMargin + x, gridY]);
                    }
                }
                gridY ++;
            }
        }
    }

    handleEvent(name, event) {
        if (name == "keydown") {
            const key = event.key;
            if (key == "s" && event.ctrlKey) {
                this.saveToFile();
            } else if (key == "Backspace") {
                this._hasUnsavedChanges = this._doc.erase();
            } else if (key == "Enter") {
                this._doc.addLinefeed();
                this._hasUnsavedChanges = true;
            } else if (key == "ArrowLeft") {
                this._doc.cursorLeft();
            } else if (key == "ArrowRight") {
                this._doc.cursorRight();
            } else if (key == "ArrowUp") {
                this._doc.cursorUp();
            } else if (key == "ArrowDown") {
                this._doc.cursorDown();
            } else if (key == "Home") {
                this._doc.cursorStartOfLine();
            } else if (key == "End") {
                this._doc.cursorEndOfLine();
            } else if (key == "PageDown") {
                for (let i = 0; i < 10; i++) {
                    this._doc.cursorDown();
                }
            } else if (key == "PageUp") {
                for (let i = 0; i < 10; i++) {
                    this._doc.cursorUp();
                }
            } else if (key.length == 1) {
                this._doc.insert(key);
                this._hasUnsavedChanges = true;
            } else {
                console.log(key);
            }

            this._update();
        }
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

    const fd = await syscall("openFile", {fileName, createIfNecessary: true});
    const text = await syscall("read", {fd});
    const lines = text.split("\n");
    await syscall("close", {fd});

    const app = new Editor(window.canvas, fileName, lines);

    window.onkeydown = (event) => {
        if (event.ctrlKey && event.key == "c") { 
            writeln("Editor shutting down").finally(resolvePromise);
        } else {
            app.handleEvent("keydown", event);
        }
    };

    window.onresize = (event) => {
        app.resize(event.width, event.height);
    }

    return programDonePromise;
}

