"use strict";

async function main(args) {

    const W = 600;
    const H = 600;

    const window = await stdlib.createWindow("Demo", [W, H], {resizable: true});

    const {
        attachUiToWindow,
        redraw,
        getElementById,
        Direction,
        AlignChildren,
        Expand,
        SelectionList,
        TextContainer,
        TextInput,
        Button,
        Container,
        Table,
        debug,

    } = gui;

    
    const canvas = window.canvas;
    const ctx = canvas.getContext("2d");

    let clickCount = 0;

    const root = new Container({bg: "#AAA", maxSize: [W, H], direction: Direction.HORIZONTAL, padding: [5, 5], expand: Expand.YES})
        .addChild(
            new Container({bg: "#666", maxSize: [W/2, H], expand: Expand.YES, padding: 5})
                .addChild(
                    new Container({bg: "#999", padding: [10, 10], expand: Expand.YES, direction: Direction.VERTICAL})
                        .addChild(
                            new Container({align: AlignChildren.CENTER, direction: Direction.HORIZONTAL, expand: [Expand.YES, Expand.NO]})
                                .addChild(new TextContainer(ctx, "Static content"))
                        )
                        .addChild(
                            new Container({bg: "#666", maxSize: [W, 80], expand: Expand.YES, padding: 5, verticalScroll: true})
                                .addChild(new TextContainer(ctx, "first line"))
                                .addChild(new TextContainer(ctx, "second line"))
                                .addChild(new TextContainer(ctx, "third line"))
                                .addChild(new TextContainer(ctx, "fourth line"))
                                .addChild(new TextContainer(ctx, "fifth line"))
                        )
                        .addChild(
                            new Container({bg: "purple", maxSize: [W, H], padding: 10, expand: Expand.IF_CHILDREN_WANT, direction: Direction.HORIZONTAL})
                                .addChild(new Container({bg: "#AAC", maxSize: [100, 50], expand: Expand.YES}))
                                .addChild(new Container({bg: "#CAA",  maxSize: [100, 50], expand: Expand.YES}))
                                .addChild(new Container({bg: "#ACA", maxSize: [100, 50], expand: Expand.YES}))
                        )
                        .addChild(
                            new Container({bg: "#666", maxSize: [W, 80], expand: Expand.YES})
                                .addChild(new TextContainer(ctx, "This is declared as one long line, but it should be automatically wrapped."))
                        )
                        .addChild(
                            new Container({bg: "#666", maxSize: [W, 50], expand: Expand.YES, verticalScroll: true, })
                                .addChild(new TextContainer(ctx, "This is declared as one long line, but it should be automatically wrapped. It should also be scrollable.", {}))
                        )
                        .addChild(
                            new Container({bg: "#666", padding: [10, 0], expand: [Expand.YES, Expand.NO], align: AlignChildren.START, direction: Direction.HORIZONTAL})
                                .addChild(new TextContainer(ctx, "Left", {}))
                        )
                        .addChild(
                            new Container({bg: "#666", expand: [Expand.YES, Expand.NO], align: AlignChildren.CENTER, direction: Direction.HORIZONTAL})
                                .addChild(new TextContainer(ctx, "Center", {}))
                        )
                        .addChild(
                            new Container({bg: "#666", padding: [10, 0], expand: [Expand.YES, Expand.NO], align: AlignChildren.END, direction: Direction.HORIZONTAL})
                                .addChild(new TextContainer(ctx, "Right", {}))
                        )
                        .addChild(
                            new Container({bg: "#666", expand: [Expand.YES, Expand.NO], verticalScroll: true})
                                .addChild(new TextContainer(ctx, "Scrollbar that isn't needed", {}))
                        )
                )
        )
        .addChild(
            new Container({bg: "#666", maxSize: [W/2 - 5, H], expand: Expand.YES, padding: 5})
                .addChild(
                    new Container({bg: "#999", padding: [10, 10], expand: Expand.YES, direction: Direction.VERTICAL})
                        .addChild(
                            new Container({align: AlignChildren.CENTER, expand: [Expand.YES, Expand.NO], direction: Direction.HORIZONTAL})
                                .addChild(new Button(ctx, "Click me", {onClick: () => {
                                    clickCount ++;
                                    getElementById("CLICK_COUNT").setText(`Clicked ${clickCount} times`);
                                    debug();
                                }}))
                        )
                        .addChild(
                            new TextContainer(ctx, "...", {id: "CLICK_COUNT", color: "#11F"})
                        )
                        .addChild(
                            new SelectionList(
                                (idx) => getElementById("SELECTION").setText(`Selected index: ${idx}`),
                                {expandHor: true, verticalScroll: true, maxHeight: 70}
                            )
                                .addItem(new TextContainer(ctx, "Select", {}))
                                .addItem(new TextContainer(ctx, "one"))
                                .addItem(new TextContainer(ctx, "of"))
                                .addItem(new TextContainer(ctx, "these"))
                                .addItem(new TextContainer(ctx, "items")),
                        )
                        .addChild(new TextContainer(ctx, "...", {id: "SELECTION",  color: "#11F"}))
                        .addChild(new TextContainer(ctx, "Type something and it will appear below:"))
                        .addChild(new TextInput(ctx, "", {maxTextLength: 20}))
                        .addChild(new Table(ctx, ["First col", "Second"], [["A", "B"], ["C", "Longer text"]]))
                )
        );

    attachUiToWindow(root, window);

    window.addEventListener("windowWasResized", (event) => {
        console.log(event);
        canvas.width = event.width;
        canvas.height = event.height;

        root._maxSize = [event.width, event.height];
        redraw();
    });

    return new Promise((r) => {});
}
