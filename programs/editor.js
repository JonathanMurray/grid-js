"use strict";

import { createWindow, read, readEntireFile, write, writeError, writeln } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";
import { assert } from "/shared.mjs";
import { DocumentWithCursor } from "/lib/document-cursor.mjs";
import { Grid } from "/lib/grid.mjs";


class Editor {

    constructor(canvas, filePath, lines) {
        this._cellSize = [10, 20];
        this._gridSize = [Math.floor(canvas.width / this._cellSize[0]), Math.floor(canvas.height / this._cellSize[1])];

        this._canvas = canvas;
        this._ctx = canvas.getContext("2d");

        this._doc = new DocumentWithCursor(lines);
        
        this._yOffset = 0;
        this._doc.cursorLine = 0;

        this._filePath = filePath;
        this._hasUnsavedChanges = false;

        this._waitingForFilePicker = false;

        this._update();
    }

    async _saveToFile() {
        const fd = await syscall("openFile", {path: this._filePath});
        const text = this._doc.lines.join("\n");
        await syscall("write", {fd, text});
        await syscall("setFileLength", {fd, length: text.length});
        await syscall("close", {fd});
        this._hasUnsavedChanges = false;
        this._update();
    }

    async _openFile(filePath) {
        assert(filePath != null);
        let lines;
        try {
            const text = await readEntireFile(filePath);
            lines = text.split(/\n|\r\n/);
        } catch (e) {
            console.warn("Couldn't open file: ", e);
            return;
        }
        this._filePath = filePath;
        this._hasUnsavedChanges = false;
        this._doc = new DocumentWithCursor(lines);
        this._update();
    }

    resize(w, h) {
        this._canvas.width = w;
        this._canvas.height = h;
        this._updateGridSize();
    }

    _updateGridSize() {
        this._gridSize = [
            Math.floor(this._canvas.width / this._cellSize[0]), 
            Math.floor(this._canvas.height / this._cellSize[1])
        ];
        this._update();
    }

    _background(color, cell) {
        this._ctx.fillStyle = color;
        Grid.fillCell(this._ctx, this._cellSize, cell);
    }

    _char(char, cell, options) {
        assert(char.length == 1);
        this._ctx.fillStyle = "black";
        Grid.characterCell(this._ctx, this._cellSize, cell, char, options);
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
        
        const statusLines = [`= ${this._filePath} = ${this._hasUnsavedChanges ? "*" : ""}`, ""];
        const statusMargin = leftMargin + 1;
        for (let y = 0; y < topMargin; y++) {
            for (let x = 0; x < this._gridSize[0]; x++) {
                this._background("lightgreen", [x, y]);
            }
            for (let x = 0; x < this._gridSize[0]; x++) {
                if (x < statusLines[y].length) {
                    this._char(statusLines[y][x], [statusMargin + x, y], {bold:true});
                } 
            }
        }
        
        const xCursor = leftMargin + cursorCol;
        const yCursor = topMargin + cursorRow - this._yOffset;

        for (let x = leftMargin; x < this._gridSize[0]; x++) {
            const color = x === xCursor ? "salmon" : "#EEE";
            this._background(color, [x, yCursor]);
        }

        let gridY = topMargin;
        let lineNumber = 0;
        for (let docY = 0; docY < rows.length; docY ++) {

            if (lineBeginnings.includes(docY)) {
                lineNumber ++;
            }

            if (docY >= this._yOffset) {
                for (let i = 0; i < leftMargin; i++) {
                    const color = gridY === yCursor ? "#CCF" : "#AAF";
                    this._background(color, [i, gridY]);
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

    async ondropdown(itemId) {
        if (this._waitingForFilePicker) {
            console.warn("Waiting for file picker");
            return;
        }
        
        if (itemId == "SAVE") {
            await this._saveToFile();
        } else if (itemId == "OPEN") {
            await this._pickFileToOpen();
        } else {
            console.log("TODO: handle dropdown: ", itemId);
        } 
    }

    async onbutton(buttonId) {
        // TODO mind the floats and blurry text (?)
        if (buttonId == "ZOOM_IN") {
            const factor = 1.1;
            this._cellSize[0] *= factor;
            this._cellSize[1] *= factor; 
            this._updateGridSize();
        } else if (buttonId == "ZOOM_OUT") {
            const factor = 0.9;
            this._cellSize[0] *= factor;
            this._cellSize[1] *= factor; 
            this._updateGridSize();
        } else {
            console.log("TODO: handle button: ", buttonId);
        } 
    }

    async _pickFileToOpen() {
        this._waitingForFilePicker = true;
        const pid = await syscall("spawn", {programPath: "/bin/filepicker2"});
        console.log("WAITING");
        const exitValue = await syscall("waitForExit", {pid});
        this._waitingForFilePicker = false;
        if ("picked" in exitValue) {
            console.log("PICKED", exitValue.picked);
            await this._openFile(exitValue.picked);
        } else {
            console.log("DIdn't pick!"); //TODO
        }
    }

    async onkeydown(event) {
        if (this._waitingForFilePicker) {
            console.warn("Waiting for file picker");
            return;
        }

        const key = event.key;
        if (event.ctrlKey && event.key == "c") { 
            await writeln("Editor shutting down");
            await syscall("exit");
        } else if (key == "s" && event.ctrlKey) {
            await this._saveToFile();
        } else if (key == "o" && event.ctrlKey) {
            await this._pickFileToOpen();
        } else if (key == "Backspace") {
            this._hasUnsavedChanges = this._doc.erase();
        } else if (key == "Enter") {
            this._doc.addLinefeed();
            this._hasUnsavedChanges = true;
        } else if (key == "ArrowLeft") {
            if (event.ctrlKey) {   
                this._doc.cursorLeftWord();
            } else {
                this._doc.cursorLeft();
            }
        } else if (key == "ArrowRight") {
            if (event.ctrlKey) {
                this._doc.cursorRightWord();
            } else {
                this._doc.cursorRight();
            }
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

    onwheel(event) {
        const speed = 5;
        if (event.deltaY < 0) {
            for (let i = 0; i < speed; i++) {
                this._doc.cursorUp();
            }
        } else {
            for (let i = 0; i < speed; i++) {
                this._doc.cursorDown();
            }
        }
        this._update();
    }
}

async function main(args) {


    let filePath;
    if (args.length > 0) {
        filePath = args[0];
    } else {
        filePath = "tmp";
    }

    const menubarItems = [
        {
            text: "File",
            dropdown: [
                {
                    text: "Save",
                    id: "SAVE"
                },
                {
                    text: "Open...",
                    id: "OPEN"
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

    const {socketFd, canvas} = await createWindow("Editor", [600, 400], {menubarItems});

    console.log("opening: ", filePath);
    let fd;
    try {
        fd = await syscall("openFile", {path: filePath, createIfNecessary: true});
    } catch (e) {
        await writeError(e["message"]);
        return;
    }
    const text = await syscall("read", {fd});
    await syscall("close", {fd});
    const lines = text.split(/\n|\r\n/);

    const app = new Editor(canvas, filePath, lines);

    while (true) {
        const received = await read(socketFd);
        const messages = JSON.parse(received);
        for (const {name, event} of messages) {
            if (name == "menubarDropdownItemWasClicked") {
                await app.ondropdown(event.itemId)
            } else if (name == "keydown") {
                await app.onkeydown(event);
            } else if (name == "windowWasResized") {
                await app.resize(event.width, event.height);
                const msg = JSON.stringify({resizeDone: null});
                await write(msg, socketFd);
            } else if (name == "wheel") {
                await app.onwheel(event);
            } else if (name == "menubarButtonWasClicked") {
                await app.onbutton(event.buttonId);
            } else if (name == "closeWasClicked") {
                return;
            }
        }
    }
}

