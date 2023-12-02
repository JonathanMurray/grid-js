"use strict";

async function main(args) {

    const window = await stdlib.createWindow("File picker", [450, 42], {resizable: false});

    const cellSize = [12, 21];
    const canvas = window.canvas;
    const ctx = canvas.getContext("2d");

    const introLine = "Input filename, and press Enter.";
    const input = new TextWithCursor();

    window.onkeydown = async function (event) {
        const key = event.key;
        if (key == "ArrowRight") {
            input.moveRight();
        } else if (key == "ArrowLeft") {
            input.moveLeft();
        } else if (key == "Backspace") {
            input.backspace();
        } else if (key == "Enter") {
            await syscall("exit", {picked: input.text});
        } else if (event.ctrlKey && key == "c") {
            await syscall("exit");
        } else if (key.length == 1) {
            input.insert(key);
        }
        draw();
    }

    function draw() {
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "salmon";
        Grid.fillCell(ctx, cellSize, [input.cursor, 1]);
        ctx.fillStyle = "black";
        for (let x = 0; x < introLine.length; x++) {
            Grid.characterCell(ctx, cellSize, [x, 0], introLine[x], {});
        }
        ctx.font
        for (let x = 0; x < input.text.length; x++) {
            Grid.characterCell(ctx, cellSize, [x, 1], input.text[x], {bold: true});
        }
    }

    draw();

    return new Promise((r) => {});
}
