"use strict";

import { TextInput, TextContainer, Container, Direction, Expand, SelectionList, AlignChildren, Button, redraw, runEventLoop } from "/lib/gui.mjs";
import { createWindow } from "/lib/stdlib.mjs";
import { syscall } from "/lib/sys.mjs";
import { FileType, resolvePath } from "/shared.mjs";

async function main(args) {

    let files = [];

    async function loadFileList(dirPath) {
        const names = await syscall("listDirectory", {path: dirPath});
        files = [];
        for (const name of names) {
            if ([".", ".."].includes(name)) {
                continue;
            }
            const path = "/" + resolvePath(dirPath, name).join("/");
            const type = await getFileType(path);
            files.push({name, path, type});
        }
        async function getFileType(path) {
            const status = await syscall("getFileStatus", {path});
            return status.type;
        }

        selectionList.removeAllItems();
        for (const file of files) {
            let color;
            if (file.type == FileType.DIRECTORY) {
                color = "#BFB";
            }
            selectionList.addItem(new TextContainer(ctx, file.name, {color}));
        }
    }

    async function setDirectory(path) {
        dirPathElement.setText(path);
        await loadFileList(path);
    }

    const {socketFd, canvas} = await createWindow("File picker", [600, 380], {resizable: false});

    const ctx = canvas.getContext("2d");
    ctx.font = "18px monospace";

    const dirPathElement = new TextContainer(ctx, "/");

    const inputElement = new TextInput(ctx, "_", {minSize: [445, 0], bg: "#555", borderColor: "#FFF"});
    let input = "";
    const errorElement = new TextContainer(ctx, "", {color: "#F99"});

    const root = new Container({maxSize: [canvas.width, canvas.height], bg: "#444", direction: Direction.VERTICAL, padding: 5, expand: Expand.YES, });

    const selectionList = new SelectionList(
        (itemIdx) => {
            onSelect(itemIdx);
        },
        {expandHor: Expand.YES, verticalScroll: true, maxHeight: 195}
    );

    root
        .addChild(
            new Container({direction: Direction.HORIZONTAL, padding: 10})
                .addChild(new Button(ctx, "<--", {onClick: onClickUp}))
                .addChild(
                    new Container({padding: [8, 5]})
                        .addChild(dirPathElement)
                )
        )
        .addChild(selectionList)
        .addChild(
            new Container({align: AlignChildren.END, expand: Expand.YES})
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
                )
        );

    async function onSelect(idx) {
        const file = files[idx];
        if (file.type == FileType.DIRECTORY) {
            await setDirectory(file.path);
        }
        input = file.path;
        updateInputElement();
    }

    async function onClickUp() {
        const parts = resolvePath(dirPathElement.getText(), "..");
        const path = "/" + parts.join("/");
        setDirectory(path);
    }

    async function onClickCancel() {
        await syscall("exit");
    }

    async function tryOpen() {

        try {
            const status = await syscall("getFileStatus", {path: input});
            if (status.type !== FileType.TEXT) {
                errorElement.setText(`Bad file type: ${status.type}`);
                return;
            }
        } catch (e) {
            errorElement.setText(e["message"]);
            return;
        }

        await syscall("exit", {picked: input});
    }

    function updateInputElement() {
        inputElement.setText(input + "_");
        errorElement.setText("");
    }

    await setDirectory("/");

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

