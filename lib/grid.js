"use strict";


class Grid {

    static pixelToCell([x, y], cellSize, gridSize) {
        console.assert(x != undefined && y != undefined);
        const col = Math.floor(x / cellSize[0]);
        const row = Math.floor(y / cellSize[1]);
        if (col >= 0 && col < gridSize[0] && row >= 0 && row < gridSize[1]) {
            return [col, row];
        }
        return null;
    }

    static fillCell(ctx, [w, h], [col, row]) {
        ctx.fillRect(col * w, row * h, w, h);
    }

    static characterCell(ctx, [w, h], [col, row], char, {centerText=false, bold=false}={}) {
        let font = (h-3) + "px monospace";
        if (bold) {
            font = "bold " + font;
        }
        ctx.font = font;
        const textMetrics = ctx.measureText(char);
        const x = col * w + (w - textMetrics.width) / 2;
        let y = row * h  + h;

        if (centerText) {
            y -= h/2;
            y += textMetrics.actualBoundingBoxAscent / 2;
        } else {
            y -= 5;
        }
        ctx.fillText(char, x, y);
    }

    static cellLines(ctx, [w, h], lines) {
        ctx.beginPath();
        ctx.lineWidth = 3;
        lines.forEach(([col0, row0, col1, row1]) => {
            ctx.moveTo(col0 * w, row0  * h);
            ctx.lineTo(col1 * w, row1 * h);
        });
        ctx.stroke();
    }

    static outlineCells(ctx, cellSize, gridSize) {
        const w = cellSize[0];
        const h = cellSize[1];

        ctx.lineWidth = 1;
        ctx.beginPath();
        
        const yBot = gridSize[1] * h;
        const xRight = gridSize[0] * w;
        for (let col = 0; col < gridSize[0] + 1; col ++) {
            const x = col * w;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, yBot);
        }
        
        for (let row = 0; row < gridSize[1] + 1; row ++) {
            const y = row * h;
            ctx.moveTo(0, y);
            ctx.lineTo(xRight, y);
        }
        ctx.stroke();
    }
}
