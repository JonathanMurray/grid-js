"use strict";

async function main(args) {

    const window = await stdlib.createWindow("Launcher", [450, 250], {resizable: false});

    const cellSize = [12, 21];
    const canvas = window.canvas;
    const ctx = canvas.getContext("2d");
    const gridSize = [Math.floor(canvas.width / cellSize[0]), Math.floor(canvas.height / cellSize[1])];

    const introLines = ["Select a program, using the arrow or w/s keys.", "Press enter to launch it.", ""];
    const programs = {
        "terminal": "Explore the system with a shell.",
        "snake": "Eat the fruit and don't collide!",
        "sudoku": "Solve the puzzle!",
        "editor": "Edit text files.",
    };
    const numPrograms = Object.keys(programs).length;

    const doc = new DocumentWithCursor();

    function moveCursor(delta) {
        doc.lines[doc.cursorLine] = doc.lines[doc.cursorLine].replace("[x]", "[ ]");
        doc.cursorLine = Math.max(Math.min(doc.cursorLine + delta, introLines.length + numPrograms - 1), introLines.length);
        doc.lines[doc.cursorLine] = doc.lines[doc.cursorLine].replace("[ ]", "[x]");

        const program = doc.lines[doc.cursorLine].replace("[x] ", "");
        doc.lines[introLines.length + numPrograms + 1] = programs[program];
    }

    window.onkeydown = (event) => {
        const key = event.key;
        if (key == "ArrowDown" || key == "s") {
            moveCursor(1);
            draw();
        }
        if (key == "ArrowUp" || key == "w") {
            moveCursor(-1);
            draw();
        }
        if (key == "Enter") {
            const program = doc.lines[doc.cursorLine].replace("[x] ", "");
            launch(program);
        }
        if (event.ctrlKey && key == "c") {
            syscall("exit");
        }
    }

    function draw() {
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "black";
        const {rows} = doc.calculateWrapped(gridSize[0]);
        for (let y = 0; y < rows.length; y++) {
            for (let x = 0; x < rows[y].length; x++) {
                Grid.characterCell(ctx, cellSize, [x, y], rows[y][x], {});
            }
        }
    }


    async function launch(program) {
        await syscall("spawn", {program, pgid: "START_NEW"});
        syscall("exit");
    }

    doc.cursorChar = 1;
    doc.cursorLine = introLines.length;

    doc.lines = introLines.concat(Object.keys(programs).map((name) => `[ ] ${name}`)).concat("", "hey there. Here are some tips");
    doc.lines[doc.cursorLine] = doc.lines[doc.cursorLine].replace("[ ]", "[x]");
    moveCursor(0);
    draw();

    return new Promise((r) => {});
}
