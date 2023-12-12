"use strict";

import { assert } from "/shared.mjs";


function debugText(ctx, text) {
    const metrics = ctx.measureText(text);
    ctx.lineWidth = 1;

    ctx.strokeStyle = "black";
    ctx.strokeRect(
        0, 
        -metrics.fontBoundingBoxAscent, 
        metrics.width, 
        metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent
    );
    ctx.beginPath();
    ctx.lineTo(0, 0);
    ctx.lineTo(metrics.width, 0);
    ctx.stroke();

    ctx.strokeStyle = "red";
    ctx.strokeRect(
        -metrics.actualBoundingBoxLeft, 
        -metrics.actualBoundingBoxAscent, 
        metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight, 
        metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
    );

    ctx.fillStyle = "white";
    ctx.fillText(text, 0, 0);
}

const Direction = {
    HORIZONTAL: "HOR",
    VERTICAL: "VERT",
}

const AlignChildren = {
    START: "START",
    END: "END",
    CENTER: "CENTER",
}

class TextContainer {
    constructor(ctx, text, {id=null, debug=false, color = "white", font = "18px monospace"} = {}) {
        this.id = id;
        if (id != null) {
            registerElement(id, this);
        }
        this._debugEnabled = debug;

        this._ctx = ctx;
        this._color = color;
        this._font = font;
        
        this._text = text;
        this._lines = [{text, width: 0}];
        this._lineHeight = 0;
        this._lineRelativeY = 0;
        this._totalSize = [0, 0];

        this._parent = null;
        
        this._widthLimit = Number.MAX_SAFE_INTEGER; // Helps us determine when we need to recompute layout
        this._recomputeLayout();
    }

    _setFont() {
        if (this._font != null) {
            this._ctx.font = this._font;
        }
    }

    _debug(...msg) {
        if (this._debugEnabled) {
            console.log("Text debug: ", ...msg);
        }
    }

    _recomputeLayout() {

        this._setFont();

        this._debug("Text Recomputing layout against allowed width: ", this._widthLimit);

        let metrics = this._ctx.measureText(this._text[0]);
        this._lineHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
        this._lineRelativeY = metrics.fontBoundingBoxAscent;

        let lines = [];
        let remaining = this._text;
        let maxLineWidth = 0;
        while (true) {
            //this._debug("Remaining: ", remaining);
            
            const remainingW = this._ctx.measureText(remaining).width;
            //this._debug("w: ", remainingW);
            const FLOAT_MARGIN = 0.0001;
            if (this._widthLimit == null || this._widthLimit == 0 || remainingW < this._widthLimit + FLOAT_MARGIN) {
                lines.push({text: remaining, width: remainingW});
                maxLineWidth = Math.max(maxLineWidth, remainingW);
                break;
            } 

            let guessIdx = Math.round(remaining.length * this._widthLimit / remainingW);
            while (true) {
                //this._debug("i: ", guessIdx);
                let guess = remaining.slice(0, guessIdx);
                let guessW = this._ctx.measureText(guess).width;
                this._debug(guess, guessW);
                if (guessW > this._widthLimit) {
                    //this._debug(guess, "Too wide: ", guessW);
                    guessIdx --;
                } else {
                    //this._debug("let's step back to whitespace: ", remaining, guess, guessW, guessIdx);
                    const whitespaceIdx = remaining.slice(0, guessIdx+1).lastIndexOf(" ");
                    if (whitespaceIdx >= 0) {
                        guessIdx = whitespaceIdx;
                    } else {
                        //console.log(`No whitespace found to break out a new line: '${remaining}'`);
                    }
                    guess = remaining.slice(0, guessIdx).trimLeft();
                    guessW = this._ctx.measureText(guess).width;
                    lines.push({text: guess, width: guessW});
                    maxLineWidth = Math.max(maxLineWidth, guessW);
                    remaining = remaining.slice(guessIdx).trimLeft();
                    break;
                }
            }
        }

        this._lines = lines;
        this._totalSize = [maxLineWidth, this._lines.length * this._lineHeight];
        this._debug("lines: ", JSON.stringify(this._lines));
        this._debug("total size: ", this._totalSize)
    }

    setText(text) {
        assert(text != null);
        this._text = text;
        this._recomputeLayout();

        if (this._parent != null) {
            this._parent.notifyChildChange();
        }
    }

    setParent(parent) {
        this._parent = parent;
    }

    getSize(available) {
        //console.log(` TextContainer::getSize(${available})`)
        assert(available[0] >= 0 && available[1] >= 0);
        assert(available != null);
        if (available[0] != this._widthLimit) {
            //assert(available[0] != 0);
            this._widthLimit = available[0];
            this._recomputeLayout();
        }
        return {required: this._totalSize, wanted: this._totalSize};
    }

    draw(ctx, allowedSize, _mouse, _keydown, {textColor=null} = {}) {
        
        this._setFont();

        if (allowedSize[0] != this._widthLimit) {
            //console.log("Text demands size: ", this._totalSize[0], " gets ", allowedSize[0]); //TODO
            this._widthLimit = allowedSize[0];
            this._recomputeLayout();
        }

        //ctx.strokeStyle = "orange";
        //ctx.strokeRect(0, 0, this._totalSize[0], this._totalSize[1]);

        ctx.fillStyle = textColor || this._color;
        let y = 0;
        for (const line of this._lines) {
            ctx.fillText(line.text, 0, y + this._lineRelativeY);
            y += this._lineHeight;
        }

        return this._totalSize;
    }
}

class TextInput {
    constructor(ctx, text, {minSize = [100, 0], maxTextLength = Number.MAX_SAFE_INTEGER, padding = [5, 5], borderColor = "white", bg = "#444"} = {}) {
        this._child = new TextContainer(ctx, text);
        this._container = new Container({minSize, bg, borderColor, borderWidth: 1, padding});
        this._container.addChild(this._child);
        this._maxTextLength = maxTextLength;
    }

    setParent(...args) {
        this._container.setParent(...args);
    }

    notifyChildChange() {
        assert(false, "Should never be called, since this element has no children");
    }

    getSize(...args) {
        return this._container.getSize(...args);
    }

    draw(ctx, allowedSize, mouse, keydown) {

        if (keydown.key != null) {
            const key = keydown.key;
            let text = this._child._text;
            if (key == "Backspace") {
                text = text.slice(0, text.length - 1);
            } else if (key.length == 1) {
                if (text.length < this._maxTextLength) {
                    text = text + key;
                }
            }
            this._child.setText(text);
        }

        return this._container.draw(ctx, allowedSize, mouse, keydown);
    }

    setText(text) {
        this._child.setText(text);
    }
}

class Button {
    constructor(ctx, text, {onClick=null} = {}) {
        const textContainer = new TextContainer(ctx, text, {});
        this._container = new Container({bg: "#666", borderColor: "#FFF", borderWidth: 2, cornerRadius: 2, padding: [15, 5]});
        this._container.addChild(textContainer);

        this._text = text;
        this._onClick = onClick;
    }

    setParent(parent) {
        this._container.setParent(parent);
    }

    notifyChildChange() {
        assert(false);
    }

    getSize(...args) {
        return this._container.getSize(...args);
    }

    draw(ctx, available, mouse, keydown) {
        
        const {required: [w, h]} = this._container.getSize(available);


        let overrides = {};
        if (mouse && mouse.pos && contains([0, 0, w, h], mouse.pos)) {
            overrides.textColor = "yellow";
            overrides.bgColor = "#777";
            overrides.borderColor = "#CCC";
            if (this._onClick != null && mouse.changedToDown) {
                this._onClick();
            }
        }

        return this._container.draw(ctx, available, mouse, keydown, overrides);
    }
}

class Table {
    static horPad = 10;
    constructor(ctx, headerColumns, rows, onSelectedRow = (_idx) => {}, {id = null} = {}) {
        if (id != null) {
            registerElement(id, this);
        }

        this._ctx = ctx;
        this._headerColumns = headerColumns;
        this._rows = rows;
        this._onSelectedRow = onSelectedRow;

        this._init();
    }

    _init() {

        const headerContainer = new Container({direction: Direction.HORIZONTAL});

        let cellWidths = [];
        for (const columnText of this._headerColumns) {
            const w = new TextContainer(this._ctx, columnText).getSize([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]).required[0] + Table.horPad * 2;
            cellWidths.push(w);
        }
        for (const row of this._rows) {
            for (let i = 0; i < row.length; i++) {
                const columnText = row[i];
                const w = new TextContainer(this._ctx, columnText).getSize([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]).required[0] + Table.horPad * 2;
                cellWidths[i] = Math.max(cellWidths[i], w);
            }
        }
        for (let i = 0; i < this._headerColumns.length; i++) {
            const columnText = this._headerColumns[i];
            headerContainer.addChild(
                new Container({minSize: [cellWidths[i], null], borderColor: "white", padding: [Table.horPad, 0]})
                    .addChild(new TextContainer(this._ctx, columnText))
            );
        }

        const rowsList = new SelectionList(
            (idx) => this._onSelectedRow(idx),
            {expandHor: Expand.NO, verticalScroll: false}
        );

        for (const row of this._rows) {
            const rowContainer = new Container({direction: Direction.HORIZONTAL});
            for (let i = 0; i < row.length; i++) {
                const columnText = row[i];
                rowContainer.addChild(
                    new Container({minSize: [cellWidths[i], null], borderColor: "white", padding: [Table.horPad, 0]})
                        .addChild(new TextContainer(this._ctx, columnText))
                );
            }
            rowsList.addItem(rowContainer);
        }
    
        this._container = new Container({bg: "#999",})
            .addChild(headerContainer)
            .addChild(rowsList);

        if (this._parent != null) {
            this._container.setParent(this._parent);
            this._parent.notifyChildChange();
        }
    }

    setRows(rows) {
        this._rows = rows;
        this._init();
    }

    notifyChildChange() {
        assert(false, "should never be called, since the table has no children");
    }

    setParent(parent) {
        this._parent = parent;
        this._container.setParent(parent);
    }

    getSize(...args) {
        return this._container.getSize(...args);
    }

    draw(...args) {
        return this._container.draw(...args);
    }
}

class SelectionList {
    constructor(onSelection, {expandHor = Expand.NO, borderColor = null, verticalScroll = false, maxHeight = Number.MAX_SAFE_INTEGER} = {}) {
        assert(Number.isInteger(maxHeight));
        this._container = new Container({direction: Direction.VERTICAL, expand: [expandHor, Expand.NO], borderColor, bg: "#555", maxSize: [Number.MAX_SAFE_INTEGER, maxHeight], verticalScroll});
        //this._container.computeLayout();
        this._itemCount = 0;
        this._onSelection = onSelection;
    }

    notifyChildChange() {
        assert(false, "should never be called, since the list has no children");
    }

    setParent(...args) {
        this._container.setParent(...args);
    }

    getSize(...args) {
        return this._container.getSize(...args);
    }

    draw(...args) {
        return this._container.draw(...args);
    }

    addItem(item) {
        const itemIndex = this._itemCount;
        const itemContainer = new Container({hoverBg: "#666", expand: [Expand.YES, Expand.NO], onClick: () => {this._onSelection(itemIndex)}});
        itemContainer.addChild(item);
        this._container.addChild(itemContainer);
        this._itemCount ++;
        return this;
    }
}

const Expand = {
    YES: "YES",
    IF_CHILDREN_WANT: "IF_CHILDREN_WANT",
    NO: "NO",
}

let nextId = 1;

class Container {
    constructor({
        id = null,
        debug = false,
        bg = null,
        hoverBg = null,
        cornerRadius = null,
        borderWidth = 1,
        borderColor = null,
        hoverBorderColor = null,
        minSize = [0, 0],
        maxSize = [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
        direction = Direction.VERTICAL,
        padding = null,
        expand=Expand.NO,
        align=AlignChildren.START,
        onClick=null,
        verticalScroll=false,
    } = {}) {
        if (id == null) {
            id = nextId ++;
        }
        this.id = id;
        registerElement(id, this);
        this._debugPrint = debug;
        this._bgColor = bg;
        this._hoverBgColor = hoverBg;
        this._cornerRadius = cornerRadius;
        this._borderWidth = borderWidth;
        this._borderColor = borderColor;
        this._hoverBorderColor = hoverBorderColor;
        this._minSize = minSize;
        this._maxSize = maxSize;
        this._direction = direction;
        if (padding == null) {
            this._padding = [0, 0];
        } else if (Number.isInteger(padding)) {
            this._padding = [padding, padding];
        } else {
            this._padding = padding;
        }

        if (Array.isArray(expand)) {
            this._expandHor = expand[0];
            this._expandVert = expand[1];
        } else {
            assert(expand != null)
            this._expandHor = expand;
            this._expandVert = expand
        }

        this._alignChildren = align;
        this._onClick = onClick;

        this._children = [];
        this._parent = null;

        this._yScrollAmount = 0;
        this._isVerticalScrollAllowed = verticalScroll;

        this._draggingScrollbar = null;

        this._cachedSizes = {};

        
        this._scrollbarW = 15;
    }

    _debug(...msg) {
        if (this._debugPrint) {
            console.log("debug: ", ...msg);
        }
    }

    addChild(widget) {
        widget.setParent(this);
        this._children.push(widget);
        this._cachedSizes = {};
        return this;
    }

    removeChild(index) {
        this._children = this._children.slice(0, index).concat(this._children.slice(index + 1));
        this._cachedSizes = {};
    }
    
    setParent(parent) {
        assert(this._parent == null);
        this._parent = parent;
    }

    notifyChildChange() {
        this._cachedSizes = {};
        
        if (this._parent != null) {
            this._parent.notifyChildChange();
        }
    }

    _recomputeLayout(available) {
        assert(available != null);
        assert(available[0] >= 0 && available[1] >= 0);


        let childX = this._padding[0];
        let childY = this._padding[1];
        let requiredForContent = [0, 0];
        let wantedForContent = [0, 0];

        let maxOrAllowed = [...available];
        assert(this._maxSize[0] != null && this._maxSize[1] != null);
        maxOrAllowed = [Math.min(maxOrAllowed[0], this._maxSize[0]),
                        Math.min(maxOrAllowed[1], this._maxSize[1])];

        for (let child of this._children) {

            let childSizeLimit = [null, null];
            if (this._direction == Direction.HORIZONTAL) {
                childSizeLimit = [maxOrAllowed[0] - childX - this._padding[0],
                                    maxOrAllowed[1] - this._padding[1] * 2];
            } else {
                assert(this._direction == Direction.VERTICAL);
                childSizeLimit[0] = maxOrAllowed[0] - this._padding[0] * 2;
                if (this._isVerticalScrollAllowed) {
                    childSizeLimit[0] -= this._scrollbarW;
                    childSizeLimit[1] = Number.MAX_SAFE_INTEGER;
                } else {
                    childSizeLimit[1] = maxOrAllowed[1] - childY - this._padding[1];
                }
            }
            childSizeLimit = [
                Math.max(0, childSizeLimit[0]),
                Math.max(0, childSizeLimit[1]),
            ];

            const {required: [childW, childH], wanted: [wantedChildW, wantedChildH]} = child.getSize(childSizeLimit);

            this._debug("Child demands: ", childW, childH);

            if (this._direction == Direction.HORIZONTAL) {
                childX += childW + this._padding[0];
                requiredForContent[0] = childX;
                requiredForContent[1] = Math.max(requiredForContent[1], childY + childH + this._padding[1]);
                wantedForContent[1] = Math.max(wantedForContent[1], wantedChildH + this._padding[1] * 2);
                wantedForContent[0] += wantedChildW + this._padding[0];
            } else {
                assert(this._direction == Direction.VERTICAL);
                childY += childH + this._padding[1];
                requiredForContent[1] = childY;
                requiredForContent[0] = Math.max(requiredForContent[0], childX + childW + this._padding[0]);
                wantedForContent[0] = Math.max(wantedForContent[0], wantedChildW + this._padding[0] * 2);
                wantedForContent[1] += wantedChildH + this._padding[1];
            }
        }

        if (this._isVerticalScrollAllowed) {
            requiredForContent[0] += this._scrollbarW;
            wantedForContent[0] += this._scrollbarW;
        }

        wantedForContent[0] = Math.min(wantedForContent[0], available[0]);
        wantedForContent[1] = Math.min(wantedForContent[1], available[1]);

        //console.log(this, "AVAILABLE: ", this._allowedSize, " WANTED FOR CONTENT: ", wantedChildrenSize); //TODO

        assert(Number.isFinite(requiredForContent[0]));
        assert(Number.isFinite(requiredForContent[1]));
        assert(Number.isFinite(wantedForContent[0]));
        assert(Number.isFinite(wantedForContent[1]));

        const required = clampedWithin(requiredForContent, this._minSize, this._maxSize);
        const wanted = clampedWithin(wantedForContent, this._minSize, this._maxSize);

        if (this._expandHor == Expand.YES) {
            wanted[0] = Math.min(available[0], this._maxSize[0]);
        } else if (this._expandHor == Expand.NO) {
            required[0] = Math.min(required[0], available[0]);
            wanted[0] = required[0];
        }
        if (this._expandVert == Expand.YES) {
            wanted[1] = Math.min(available[1], this._maxSize[1]);
        } else if (this._expandVert == Expand.NO) {
            required[1] = Math.min(required[1], available[1]);
            wanted[1] = required[1];
        }

        //console.log(this, "Required: ", required, "Wanted: ", wanted); //TODO

        this._cachedSizes[available] = {
            requiredForContent,
            required,
            wanted
        };


        return this._cachedSizes[available];
    }

    getSize(available) {
        //console.log("requested size ", limit, this); //TODO
        assert(available != null);
        assert(available[0] >= 0 && available[1] >= 0);

        let cachedSize = this._cachedSizes[available];

        if (cachedSize == null) {
            cachedSize = this._recomputeLayout(available);
        }

        return {required: cachedSize.required, wanted: cachedSize.wanted};
    }

    draw(ctx, available, mouse, keydown, overrides={}) {
        this._debug("Draw, ", available, this); //TODO

        assert (available[0] != null && available[1] != null);

        if (mouse.changedToUp) {
            this._draggingScrollbar = null;
        }

        //console.log("This demanded size", w, h, this); //TODO

        let childrenOffset = [0, -this._yScrollAmount];

        const size = this.getSize(available);

        let [w, h] = size.wanted;

        const clipRect = [0, 0, w - this._padding[0], h - this._padding[1]]; 

        const requiredSizeForContent = this._cachedSizes[available].requiredForContent;

        if (requiredSizeForContent[0] <= w) {
            if (this._direction == Direction.HORIZONTAL) {
                if (this._alignChildren == AlignChildren.END) {
                    childrenOffset[0] += w - requiredSizeForContent[0];
                } else if (this._alignChildren == AlignChildren.CENTER) {
                    childrenOffset[0] += (w - requiredSizeForContent[0]) / 2;
                }
            }
        }
    
        const hover = mouse && mouse.pos && contains([0, 0, w, h], mouse.pos);
        let scrollbar = null;

        if (requiredSizeForContent[1] <= h) {
            if (this._direction == Direction.VERTICAL) {
                if (this._alignChildren == AlignChildren.END) {
                    childrenOffset[1] += h - requiredSizeForContent[1];
                } else if (this._alignChildren == AlignChildren.CENTER) {
                    childrenOffset[1] += (h - requiredSizeForContent[1]) / 2;
                }
            }
        }
        
        let allowedChildrenSize = [w - this._padding[0] * 2, h - this._padding[1] * 2];

        if (this._isVerticalScrollAllowed) {
            allowedChildrenSize[0] -= this._scrollbarW;
            if (requiredSizeForContent[1] <= h) {
                this._yScrollAmount = 0;
                scrollbar = [w - this._scrollbarW, 0, this._scrollbarW, h];
            } else {

                const minScroll = 0;
                const maxScroll = requiredSizeForContent[1] - h;

                this._debug("size requested by childreN: ", requiredSizeForContent);
                const scrollbarH = h * h / requiredSizeForContent[1];

                if (hover && mouse.scrollDelta != undefined) {
                    //console.log("mouse scroll: ", mouse.scrollDelta);
                    const delta = Math.sign(mouse.scrollDelta) * 30;
                    this._yScrollAmount = Math.max(
                        Math.min(this._yScrollAmount + delta, maxScroll),
                        minScroll);

                    //console.log("Scroll offset: ", this._scrollOffset);
                } else if (this._draggingScrollbar != null) {
                    const desiredScrollbarY = mouse.pos[1] - this._draggingScrollbar.offset;
                    const desiredYScrollAmount = desiredScrollbarY * maxScroll / (h - scrollbarH);
                    this._yScrollAmount = Math.max(
                        Math.min(desiredYScrollAmount, maxScroll),
                        minScroll);
                }
        
                const scrollbarY = (this._yScrollAmount / maxScroll) * (h - scrollbarH);
                scrollbar = [w - this._scrollbarW, scrollbarY, this._scrollbarW, scrollbarH];
            }
        }


        if (hover && mouse.changedToDown && this._onClick) {
            this._onClick();
        }

        ctx.beginPath();
        if (this._cornerRadius != null) {
            ctx.roundRect(0, 0, w, h, this._cornerRadius);
        } else {
            ctx.rect(0, 0, w, h);
        }

        let bgColor;
        if (overrides.bgColor) {
            bgColor = overrides.bgColor;
        } else if (hover && this._hoverBgColor) {
            bgColor = this._hoverBgColor;
        } else {
            bgColor = this._bgColor;
        }
        
        if (bgColor != null) {
            ctx.fillStyle = bgColor;
            ctx.fill();
        }

        let borderColor;
        if (overrides.borderColor) {
            borderColor = overrides.borderColor;
        } else if (hover && this._hoverBorderColor != null) {
            borderColor = this._hoverBorderColor;
        } else {
            borderColor = this._borderColor;
        }
        //borderColor = "magenta"; //TODO
        if (borderColor != null) {
            ctx.strokeStyle = borderColor;
            ctx.lineWidth = this._borderWidth;
            ctx.stroke();
        }

        let childX = childrenOffset[0] + this._padding[0];
        let childY = childrenOffset[1] + this._padding[1];
        for (let child of this._children) {
            ctx.save();
            ctx.translate(childX, childY);

            const childClipRect = [clipRect[0] - childX, clipRect[1] - childY, clipRect[2], clipRect[3]];
            ctx.rect(...childClipRect);
            ctx.clip();
            //console.log("Clipped for child: ", clipRect[0] - childX, clipRect[1] - childY, clipRect[2], clipRect[3]); //TODO

            let allowedChildSize;
            if (this._direction == Direction.HORIZONTAL) {
                allowedChildSize = [allowedChildrenSize[0] - childX + this._padding[0], allowedChildrenSize[1]];
            } else {
                assert(this._direction == Direction.VERTICAL);
                allowedChildSize = [allowedChildrenSize[0], allowedChildrenSize[1] - childY + this._padding[1]];
            }
            allowedChildSize = [
                Math.max(0, allowedChildSize[0]),
                Math.max(0, allowedChildSize[1]),
            ];
            
            
            let {wanted: [childW, childH]} = child.getSize(allowedChildSize);

            //console.log("allowed child size: ", allowedChildSize); //TODO

            let isChildVisible = true;
            // TODO: also handle the horizontal case
            if (childClipRect != null) {
                isChildVisible = childClipRect[1] < childH && childClipRect[1] + childClipRect[3] > 0;
            }

            if (isChildVisible) {
                [childW, childH] = child.draw(ctx, allowedChildSize, convertMousePosition(mouse, [childX, childY]), keydown, overrides);
            }

            ctx.translate(-childX, -childY);

            if (this._direction == Direction.HORIZONTAL) {
                childX += this._padding[0] + childW;
            } else {
                assert(this._direction == Direction.VERTICAL);
                childY += this._padding[1] + childH;
            }
            
            ctx.restore();
        }

        if (scrollbar != null) {
            ctx.fillStyle = "#333";
            ctx.fillRect(scrollbar[0], 0, scrollbar[2], h);

            if (this._draggingScrollbar != null) {
                ctx.fillStyle = "#AAA";
            } else if (contains(scrollbar, mouse.pos)) {
                ctx.fillStyle = "#888";
                if (mouse.changedToDown) {
                    this._draggingScrollbar = {offset: mouse.pos[1] - scrollbar[1]};
                    //console.log("SCROLL FROM ", this._draggingScrollbar);
                }
            } else {
                ctx.fillStyle = "#666";
            }

            ctx.beginPath();
            const scrollbarMargin = 1;
            ctx.rect(scrollbar[0] + scrollbarMargin, scrollbar[1] + scrollbarMargin, 
                scrollbar[2] - scrollbarMargin*2, scrollbar[3] - scrollbarMargin*2);
            ctx.fill();
        }

        return [w, h];
    }
}

function clampedWithin(v, minV, maxV) {
    return [
        Math.min(Math.max(minV[0], v[0]), maxV[0]),
        Math.min(Math.max(minV[1], v[1]), maxV[1]),
    ]
}

function contains([x, y, w, h], [x0, y0]) {
    return x0 > x && x0 < x + w && y0 > y && y0 < y + h;
}

function equals(v0, v1) {
    if (v0 == null && v1 == null) {
        return true;
    }
    if (v0 == null || v1 == null) {
        return false;
    }
    return v0[0] == v1[0] && v0[1] == v1[1];
}

function convertMousePosition(mouse, childPos) {
    if (mouse == null) {
        return null;
    }
    if (mouse.pos == null) {
        return mouse;
    }
    let converted = {...mouse};
    converted.pos = [mouse.pos[0] - childPos[0], mouse.pos[1] - childPos[1]];
    return converted;
}

function registerElement(id, element) {
    assert(!(id in STATE.elementsById));
    STATE.elementsById[id] = element;
}

let STATE = {
    mousePos: [-1, -1],
    ctx: null,
    root: null,
    canvas: null,
    elementsById: {},
};

function attachUiToWindow(rootElement, window) {
    STATE.ctx = window.canvas.getContext("2d");
    STATE.root = rootElement;
    STATE.canvas = window.canvas;

    window.addEventListener("mousemove", (event) => {
        STATE.mousePos = [event.x, event.y];
        redraw();
    });
    window.addEventListener("mousedown", (event) => {
        redraw({changedToDown: true});
    });
    window.addEventListener("mouseup", (event) => {
        redraw({changedToUp: true});
    });
    window.addEventListener("wheel", (event) => {
        redraw({scrollDelta: event.deltaY});
        redraw();
    });

    window.addEventListener("keydown", async function(event) {
        redraw({}, event);
    });

    redraw();
}

function redraw(mouseEvent={}, keydownEvent={}) {
    STATE.ctx.resetTransform();
    //STATE.root.computeLayout();
    STATE.root.draw(STATE.ctx, [STATE.canvas.width, STATE.canvas.height], {...mouseEvent, pos: STATE.mousePos}, keydownEvent);
}

function getElementById(id) {
    assert(id != null);
    const element = STATE.elementsById[id];
    assert(element != null);
    return element;
}

function debug() {
    console.log(STATE);
}

export {
    attachUiToWindow,
    redraw,
    debug,
    getElementById,
    Direction,
    AlignChildren,
    Expand,
    Container,
    TextContainer,
    TextInput,
    Button,
    SelectionList,
    Table,
};
