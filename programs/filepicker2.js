"use strict";

import { TextInput, TextContainer, Container, Direction, Expand, SelectionList, AlignChildren, Button, redraw, runEventLoop } from "/lib/gui.mjs";
import { createWindow } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";

async function main(args) {

    let filePaths = await syscall("listFiles", {path: "/"});

    const {socketFd, canvas} = await createWindow("File picker", [600, 320], {resizable: false});

    const ctx = canvas.getContext("2d");

    ctx.font = "18px monospace";

    const inputElement = new TextInput(ctx, "_", {minSize: [445, 0], bg: "#555", borderColor: "#FFF"});
    let input = "";
    const errorElement = new TextContainer(ctx, "", {color: "#F99"});

    const root = new Container({maxSize: [canvas.width, canvas.height], bg: "#444", direction: Direction.VERTICAL, padding: 5, expand: Expand.YES, });

    const selectionList = new SelectionList(
        (itemIdx) => {
            input = filePaths[itemIdx];
            updateInputElement();
        },
        {expandHor: Expand.YES, verticalScroll: true, maxHeight: 195}
    );
    root.addChild(selectionList);

    for (const filePath of filePaths) {
        selectionList.addItem(new TextContainer(ctx, filePath));
    }

    root
        .addChild(
            new Container({direction: Direction.HORIZONTAL, padding: 10})
                .addChild(
                    new Container({padding: [8, 5]})
                        .addChild(new TextContainer(ctx, "File name:"))
                )
                .addChild(inputElement)
        )
        .addChild(
            new Container({direction: Direction.HORIZONTAL, padding: 10, expand: Expand.YES, align: AlignChildren.END})
                .addChild(new Container({padding: [10, 5]}).addChild(errorElement))
                .addChild(new Button(ctx, "Open", {onClick: tryOpen}))
                .addChild(new Button(ctx, "Cancel", {onClick: onClickCancel}))
        );

    async function onClickCancel() {
        await syscall("exit");
    }

    async function tryOpen() {
        if (filePaths.includes(input)) {
            await syscall("exit", {picked: input});
        }
        errorElement.setText("No such file!");
    }

    function updateInputElement() {
        inputElement.setText(input + "_");
        errorElement.setText("");
    }

    for await (const {name, event} of runEventLoop(root, socketFd, canvas)) {
        if (name == "keydown") {
            const key = event.key;
            errorElement.setText("");
            if (key == "Backspace") {
                if (event.ctrlKey) {
                    input = "";
                } else {
                    input = input.slice(0, input.length - 1);
                }
                updateInputElement();
            } else if (key == "Enter") {
                await tryOpen();
            } else if (key.length == 1) {
                input += key;
                updateInputElement();
            }
    
            redraw();
        }
    }
}

