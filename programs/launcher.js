"use strict";

async function main(args) {

    const window = await stdlib.createWindow("Launcher", [450, 250], {resizable: false});

    const canvas = window.canvas;
    const textGrid = new TextGrid(canvas, [12, 21]);

    const introLines = ["Select a program, using the arrow or w/s keys.", "Press enter to launch it.", ""];
    const programs = {
        "terminal": "Explore the system with a shell.",
        "snake": "Eat the fruit and don't collide!",
        "sudoku": "Solve the puzzle!",
        "editor": "Edit text files.",
    };
    const numPrograms = Object.keys(programs).length;

    function moveCursor(delta) {
        textGrid.lines[textGrid.cursorLine] = textGrid.lines[textGrid.cursorLine].replace("[x]", "[ ]");
        textGrid.cursorLine = Math.max(Math.min(textGrid.cursorLine + delta, introLines.length + numPrograms - 1), introLines.length);
        textGrid.lines[textGrid.cursorLine] = textGrid.lines[textGrid.cursorLine].replace("[ ]", "[x]");

        const program = textGrid.lines[textGrid.cursorLine].replace("[x] ", "");
        textGrid.lines[introLines.length + numPrograms + 1] = programs[program];
    }

    window.onkeydown = (event) => {
        const key = event.key;
        if (key == "ArrowDown" || key == "s") {
            moveCursor(1);
            textGrid.draw();
        }
        if (key == "ArrowUp" || key == "w") {
            moveCursor(-1);
            textGrid.draw();
        }
        if (key == "Enter") {
            const program = textGrid.lines[textGrid.cursorLine].replace("[x] ", "");
            launch(program);
        }
        if (event.ctrlKey && key == "c") {
            syscall("exit");
        }
    }


    async function launch(program) {
        await syscall("spawn", {program, pgid: "START_NEW"});
        syscall("exit");
    }

    textGrid.cursorChar = 1;
    textGrid.cursorLine = introLines.length;

    textGrid.lines = introLines.concat(Object.keys(programs).map((name) => `[ ] ${name}`)).concat("", "hey there. Here are some tips");
    textGrid.lines[textGrid.cursorLine] = textGrid.lines[textGrid.cursorLine].replace("[ ]", "[x]");
    moveCursor(0);
    textGrid.draw();

    return new Promise((r) => {});
}
