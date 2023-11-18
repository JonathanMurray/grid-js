"use strict";

class Grid {
    constructor(canvas, {numColumns, numRows, cellSize, xOffset, yOffset}) {
        xOffset = xOffset || 0;
        yOffset = yOffset || 0;
        if (numColumns != undefined) {
            console.assert(numRows != undefined);
            if (cellSize == undefined) {
                cellSize = [Math.floor((canvas.width - xOffset) / numColumns), 
                            Math.floor((canvas.height - yOffset) / numRows)];
            }
        } else {
            console.assert(cellSize != undefined);
            numColumns = Math.floor((canvas.width - xOffset) / cellSize[0]);
            numRows = Math.floor((canvas.height - yOffset) / cellSize[1]);

        }

        console.assert(numColumns > 0);
        console.assert(numRows > 0);
        console.assert(cellSize.length == 2);

        if (xOffset + numColumns * cellSize[0] > canvas.width) {
            console.warn(`Grid width exceeds canvas size! ${xOffset + numColumns * cellSize[0]} > ${canvas.width}`);
        }
        if (yOffset + numRows * cellSize[1] > canvas.height) {
            console.warn(`Grid height exceeds canvas size! ${yOffset + numRows * cellSize[1]} > ${canvas.height}`);
        }

        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");

        this.cellSize = cellSize;
        this.strokeStyle = "black";

        this.initCells(numColumns, numRows);

        this.lines = [];

        this.xLeft = xOffset;
        this.yTop = yOffset;

        this.centerText = true;
        this.showBackgroundLines = true;

        this.background = "white";
    }

    resizeCanvasWhileMaintainingCellSize(canvasWidth, canvasHeight) {
        this.canvas.width = canvasWidth;
        this.canvas.height = canvasHeight;
        const numColumns = Math.floor((this.canvas.width - this.xLeft) / this.cellSize[0]);
        const numRows = Math.floor((this.canvas.height - this.yTop) / this.cellSize[1]);
        this.initCells(numColumns, numRows);
    }

    resizeCanvasLetterboxed(canvasWidth, canvasHeight) {
        this.canvas.width = canvasWidth;
        this.canvas.height = canvasHeight;
        
        const aspectRatio = this.cellSize[1] / this.cellSize[0];
        this.cellSize = [Math.floor((this.canvas.width - this.xLeft) / this.numColumns), 
                         Math.floor((this.canvas.height - this.yTop) / this.numRows)];
        if (this.cellSize[0] > this.cellSize[1] / aspectRatio) {
            this.cellSize[0] = this.cellSize[1] / aspectRatio;
        } else if (this.cellSize[1] > this.cellSize[0] * aspectRatio) {
            this.cellSize[1] = this.cellSize[0] * aspectRatio;
        }
    }

    initCells(numColumns, numRows) {
        this.numColumns = numColumns;
        this.numRows = numRows;
        this.characters = [];
        for (let col = 0; col < numColumns; col ++) {
            this.characters.push(new Array(numRows));
        }

        this.backgrounds = [];
        for (let col = 0; col < numColumns; col ++) {
            this.backgrounds.push(new Array(numRows));
        }

        this.foregrounds = [];
        for (let col = 0; col < numColumns; col ++) {
            this.foregrounds.push(new Array(numRows));
        }
    }

    pixelToCell(x, y) {
        console.assert(x != undefined && y != undefined);
        const col = Math.floor((x - this.xLeft) / this.cellSize[0]);
        const row = Math.floor((y - this.yTop) / this.cellSize[1]);
        if (col >= 0 && col < this.numColumns && row >= 0 && row < this.numRows) {
            return [col, row];
        }
        return null;
    }

    draw() {

        this.ctx.fillStyle = this.background;
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        const w = this.cellSize[0];
        const h = this.cellSize[1];
        const xLeft = this.xLeft;
        const yTop = this.yTop;

        this.forEachCell((col, row) => {
            const bg = this.backgroundAt(col, row);
            if (bg != null) {
                this.ctx.fillStyle = bg;
                this.ctx.fillRect(xLeft + col * w, yTop + row * h, w, h);
            }
        });

        if (this.showBackgroundLines) {
            this.drawBackgroundLines();
        }

        this.ctx.font = h + "px monospace";
        this.forEachCell((col, row) => {
            const char = this.characterAt(col, row);
            if (char != null) {
                const textMetrics = this.ctx.measureText(char);
                const x = xLeft + col * w + (w - textMetrics.width) / 2;
                let y = yTop + row * h  + h;

                if (this.centerText) {
                    y -= h/2;
                    y += textMetrics.actualBoundingBoxAscent / 2;
                } else {
                    y -= 2;
                }
                const fg = this.foregroundAt(col, row) || "black";
                this.ctx.fillStyle = fg;
                this.ctx.fillText(char, x, y);
            }
        });

        this.ctx.beginPath();
        this.ctx.lineWidth = 3;
        this.lines.forEach(([col0, row0, col1, row1]) => {
            this.ctx.moveTo(xLeft + col0 * w, yTop + row0  * h);
            this.ctx.lineTo(xLeft + col1 * w, yTop + row1 * h);
        });
        this.ctx.stroke();
    }

    drawBackgroundLines() {
        const w = this.cellSize[0];
        const h = this.cellSize[1];
        const xLeft = this.xLeft;
        const yTop = this.yTop;

        this.ctx.strokeStyle = this.strokeStyle;
        this.ctx.lineWidth = 1;
        this.ctx.style = this.style;
        this.ctx.beginPath();
        
        const yBot = yTop + this.numRows * h;
        const xRight = xLeft + this.numColumns * w;
        for (let col = 0; col < this.numColumns + 1; col ++) {
            const x = xLeft + col * w;
            this.ctx.moveTo(x, yTop);
            this.ctx.lineTo(x, yBot);
        }
        
        for (let row = 0; row < this.numRows + 1; row ++) {
            const y = yTop + row * h;
            this.ctx.moveTo(xLeft, y);
            this.ctx.lineTo(xRight, y);
        }
        this.ctx.stroke();
    }

    characterAt(col, row) {
        if (col in this.characters && row in this.characters[col]) {
            return this.characters[col][row];
        }
        return null;
    }

    foregroundAt(col, row) {
        if (col in this.foregrounds && row in this.foregrounds[col]) {
            return this.foregrounds[col][row];
        }
        return null;
    }

    backgroundAt(col, row) {
        if (col in this.backgrounds && row in this.backgrounds[col]) {
            return this.backgrounds[col][row];
        }
        return null;
    }

    forEachCell(consumer) {
        for (let col = 0; col < this.numColumns; col ++) {
            for (let row = 0; row < this.numRows; row ++) {
                consumer(col, row);
            }
        }
    }
}
