"use strict";

import { Container, Direction, Expand, SelectionList, TextContainer, AlignChildren, Button, redraw, runEventLoop } from "/lib/gui.mjs";
import { createWindow } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";

async function main(args) {

    const {socketFd, canvas} = await createWindow("Launcher", [450, 300], {resizable: false});

    const descriptions = {
        "terminal": "Explore the system with a shell.",
        "snake": "Eat the fruit and don't collide!",
        "sudoku": "Solve the puzzle!",
        "editor": "Edit text files.",
        "taskman": "Monitor running processes",
        "demo": "(Showcase of GUI capabilities)",
    };
    const fileNames = Object.keys(descriptions);

    const ctx = canvas.getContext("2d");
    
    let picked = null;

    ctx.font = "18px monospace";

    const root = new Container({maxSize: [canvas.width, canvas.height], bg: "#444", direction: Direction.VERTICAL, padding: [10, 5], expand: Expand.YES});

    const selectionList = new SelectionList(
        (itemIdx) => {
            picked = fileNames[itemIdx];
            titleElement.setText(picked);
            descriptionElement.setText(descriptions[picked]);
        },
        {expandHor: Expand.YES}
    );
  
    for (const fileName of fileNames) {
        selectionList.addItem(new Container({padding: [5, 0]}).addChild(new TextContainer(ctx, fileName)));
    }

    const titleElement = new TextContainer(ctx, "", {color: "magenta", font: "bold 20px monospace"});
    const descriptionElement = new TextContainer(ctx, "", {color: "#FFF"});

    root
        .addChild(new TextContainer(ctx, "Select a program:", {font: "bold 20px monospace"}))
        .addChild(new Container({padding: [0, 5]}))
        .addChild(selectionList)
        .addChild(new Container({padding: [0, 5]}))
        .addChild(new Container().addChild(titleElement))
        .addChild(new Container().addChild(descriptionElement))
            .addChild(
                new Container({direction: Direction.HORIZONTAL, padding: 10, expand: Expand.YES, align: AlignChildren.END})
                    .addChild(new Button(ctx, "Launch", {onClick: maybeLaunch}))
                    .addChild(new Button(ctx, "Cancel", {onClick: cancel}))
            );

    async function cancel() {
        await syscall("exit");
    }

    async function maybeLaunch() {
        if (picked != null) {
            await syscall("spawn", {program: picked, pgid: "START_NEW"});
            await syscall("exit");
        }
    }

    for await (const {name, event} of runEventLoop(root, socketFd, canvas)) {
        if (name == "keydown") {
            const key = event.key;
            if (key == "Enter") {
                await maybeLaunch();
                redraw();
            } 
        }
    }

}
