"use strict";

const gui = function () {

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
        constructor(ctx, text, {id, color = "white", font = "18px monospace"} = {}) {
            this.id = id;
            if (id != null) {
                registerElement(id, this);
            }

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
            //console.log(...msg);
        }

        _recomputeLayout() {

            this._setFont();

            this._debug("TExt Recomputing layout against allowed width: ", this._widthLimit);

            let metrics = this._ctx.measureText(this._text[0]);
            this._lineHeight = metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
            this._lineRelativeY = metrics.fontBoundingBoxAscent;

            let lines = [];
            let remaining = this._text;
            let maxLineWidth = 0;
            while (true) {
                this._debug("Remaining: ", remaining);
                
                const remainingW = this._ctx.measureText(remaining).width;
                this._debug("w: ", remainingW);
                if (this._widthLimit == null || remainingW < this._widthLimit) {
                    lines.push({text: remaining, width: remainingW});
                    maxLineWidth = Math.max(maxLineWidth, remainingW);
                    break;
                } 

                let guessIdx = Math.round(remaining.length * this._widthLimit / remainingW);
                while (true) {
                    this._debug("i: ", guessIdx);
                    let guess = remaining.slice(0, guessIdx);
                    let guessW = this._ctx.measureText(guess).width;
                    this._debug(guess, guessW);
                    if (guessW > this._widthLimit) {
                        this._debug(guess, "Too wide: ", guessW);
                        guessIdx --;
                    } else {
                        const whitespaceIdx = remaining.slice(0, guessIdx).lastIndexOf(" ");
                        if (whitespaceIdx >= 0) {
                            guessIdx = whitespaceIdx;
                        } else {
                            console.log(`No whitespace found to break out a new line: '${remaining}'`);
                        }
                        guess = remaining.slice(0, guessIdx).trimLeft();
                        guessW = this._ctx.measureText(guess).width;
                        //console.log(guess, "Good enough! ", guessW);
                        lines.push({text: guess, width: guessW});
                        maxLineWidth = Math.max(maxLineWidth, guessW);
                        remaining = remaining.slice(guessIdx).trimLeft();
                        break;
                    }
                }
            }

            this._lines = lines;
            this._totalSize = [maxLineWidth, this._lines.length * this._lineHeight];
            //console.log("lines: ", this._lines);
            //console.log("total size: ", this._totalSize)
        }

        setText(text) {
            this._text = text;
            this._recomputeLayout();

            if (this._parent != null) {
                this._parent.computeLayout();
            }
        }

        setParent(parent) {
            this._parent = parent;
        }

        requestedSize(limit) {
            //console.log(` TextContainer::requestedSize(${maxSize})`)
            assert(limit != null);
            if (limit[0] != this._widthLimit) {
                assert(limit[0] != 0 && limit[1] != 0);
                this._widthLimit = limit[0];
                this._recomputeLayout();
            }
            return this._totalSize;
        }

        draw(ctx, allowedSize, _mouse, _keydown, {textColor=null} = {}) {
            
            this._setFont();

            if (allowedSize[0] != null) {
                if (allowedSize[0] != this._widthLimit) {
                    //console.log("Text demands size: ", this._totalSize[0], " gets ", allowedSize[0]); //TODO
                    this._widthLimit = allowedSize[0];
                    this._recomputeLayout();
                }
            }

            //ctx.strokeStyle = "magenta";
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
            this._textContainer = new TextContainer(ctx, text);
            this._inner = new Container({minSize, bg, borderColor, borderWidth: 1, padding});
            this._inner.addChild(this._textContainer);
            this._maxTextLength = maxTextLength;
        }

        setParent(parent) {
            this._inner.setParent(parent);
        }

        computeLayout() {
            assert(false, "Should never be called, since this element has no children");
        }

        requestedSize(limit) {
            return this._inner.requestedSize(limit);
        }

        draw(ctx, allowedSize, mouse, keydown) {

            if (keydown.key != null) {
                const key = keydown.key;
                let text = this._textContainer._text;
                if (key == "Backspace") {
                    text = text.slice(0, text.length - 1);
                } else if (key.length == 1) {
                    if (text.length < this._maxTextLength) {
                        text = text + key;
                    }
                }
                this._textContainer.setText(text);
            }

            return this._inner.draw(ctx, allowedSize, mouse, keydown);
        }

        setText(text) {
            this._textContainer.setText(text);
        }
    }

    class Button {
        constructor(ctx, text, {onClick=null} = {}) {
            const textContainer = new TextContainer(ctx, text);
            this._inner = new Container({bg: "#666", borderColor: "#FFF", borderWidth: 2, cornerRadius: 2, padding: [15, 5]});
            this._inner.addChild(textContainer);

            this._text = text;
            this._onClick = onClick;
        }

        setParent(_parent) {}
        computeLayout() {}

        requestedSize(limit) {
            return this._inner.requestedSize(limit);
        }

        draw(ctx, allowedSize, mouse, keydown) {
            const [w, h] = this._inner.requestedSize(allowedSize);

            let overrides = {};
            if (mouse && mouse.pos && contains([0, 0, w, h], mouse.pos)) {
                overrides.textColor = "yellow";
                overrides.bgColor = "#777";
                overrides.borderColor = "#CCC";
                if (this._onClick != null && mouse.changedToDown) {
                    this._onClick();
                }
            }

            return this._inner.draw(ctx, allowedSize, mouse, keydown, overrides);
        }
    }
    
    class SelectionList {
        constructor(maxHeight, onSelection) {
            assert(Number.isInteger(maxHeight));
            this._container = new Container({direction: Direction.VERTICAL, stretch: [true, false], bg: "#555", maxSize: [Number.MAX_SAFE_INTEGER, maxHeight], verticalScroll: true});
            this._container.computeLayout();
            this._itemCount = 0;
            this._onSelection = onSelection;
        }

        computeLayout() {
            assert(false, "should never be called, since the list has no children");
        }

        setParent(parent) {
            this._container.setParent(parent);
        }

        requestedSize(limit) {
            return this._container.requestedSize(limit);
        }

        draw(ctx, allowedSize, mouse, keydown, overrides={}) {
            return this._container.draw(ctx, allowedSize, mouse, keydown, overrides);
        }

        addItem(item) {
            const itemIndex = this._itemCount;
            const itemContainer = new Container({hoverBg: "#666", stretch: [true, false], onClick: () => {this._onSelection(itemIndex)}});
            itemContainer.addChild(item);
            this._container.addChild(itemContainer);
            this._itemCount ++;
            return this;
        }
    }

    class Container {
        constructor({
            id = null,
            bg = null,
            hoverBg = null,
            cornerRadius = null,
            borderWidth = 1,
            borderColor = null,
            hoverBorderColor = null,
            minSize = [0, 0],
            maxSize = null,
            direction = Direction.VERTICAL,
            padding = null,
            stretch=false,
            align=AlignChildren.START,
            onClick=null,
            verticalScroll=false,
        } = {}) {
            this.id = id;
            if (id != null) {
                registerElement(id, this);
            }
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
            if (typeof stretch == "boolean") {
                this._stretchHorizontally = stretch;
                this._stretchVertically = stretch;
            } else {
                assert(stretch != null)
                this._stretchHorizontally = stretch[0];
                this._stretchVertically = stretch[1];
            }
            this._alignChildren = align;
            this._onClick = onClick;

            this._children = [];
            this._sizeRequestedByChildren = null;
            this._parent = null;

            this._yScrollAmount = 0;
            this._isVerticalScrollAllowed = verticalScroll;

            this._draggingScrollbar = null;
        }

        addChild(widget) {
            widget.setParent(this);
            this._children.push(widget);
            this.computeLayout();
            return this;
        }

        removeChild(index) {
            this._children = this._children.slice(0, index).concat(this._children.slice(index + 1));
            this.computeLayout();
        }
        
        setParent(parent) {
            assert(this._parent == null);
            this._parent = parent;
        }

        computeLayout() {

            let childX = this._padding[0];
            let childY = this._padding[1];
            let rightX = 0;
            let bottomY = 0;

            for (let child of this._children) {

                let childSizeLimit = [null, null];
                if (this._maxSize != null) {
                    assert(this._maxSize[0] != null && this._maxSize[1] != null);
                    if (this._direction == Direction.HORIZONTAL) {
                        childSizeLimit[1] = this._maxSize[1] - this._padding[1] * 2;
                    } else {
                        assert(this._direction == Direction.VERTICAL);
                        childSizeLimit[0] = this._maxSize[0] - this._padding[0] * 2;
                    }
                }

                const [childW, childH] = child.requestedSize({limit: childSizeLimit});

                //console.log("Child demands: ", childW, childH);

                if (this._direction == Direction.HORIZONTAL) {
                    childX += this._padding[0] + childW;
                    rightX = childX;
                    bottomY = Math.max(bottomY, childY + childH + this._padding[1])
                } else {
                    assert(this._direction == Direction.VERTICAL);
                    childY += this._padding[1] + childH;
                    rightX = Math.max(rightX, childX + childW + this._padding[0]);
                    bottomY = childY;
                }
            }

            this._sizeRequestedByChildren = [rightX, bottomY];

            if (this._parent != null) {
                this._parent.computeLayout();
            }
        }

        requestedSize(_limit) {
            if (this._sizeRequestedByChildren == null) {
                // The element has no children, which is equivalent to having 0-sized children
                this._sizeRequestedByChildren = [0, 0];
            }

            let [w, h] = [Math.max(this._sizeRequestedByChildren[0], this._minSize[0]),
                          Math.max(this._sizeRequestedByChildren[1], this._minSize[1])];

            if (this._maxSize != null) {
                assert(this._maxSize[0] != null && this._maxSize[1] != null);
                // even if children demand more space, we refuse to grow beyond our max size

                //console.log("Children min size: ", this._childrenMinSize, " but container max size: ", this._maxSize); //TODO

                w = Math.min(w, this._maxSize[0]);
                h = Math.min(h, this._maxSize[1]);
            }

            return [w, h];
        }

        draw(ctx, allowedSize, mouse, keydown, overrides={}) {
            //console.log("Draw, ", allowedSize, this); //TODO

            assert (allowedSize[0] != null && allowedSize[1] != null);

            if (mouse.changedToUp) {
                this._draggingScrollbar = null;
            }

            let [w, h] = this.requestedSize(allowedSize);

            //console.log("This demanded size", w, h, this); //TODO

            let childrenOffset = [0, -this._yScrollAmount];

            if (this._stretchHorizontally) {
                w = Math.max(w, allowedSize[0]);
            }
            if (this._stretchVertically) {
                h = Math.max(h, allowedSize[1]);
            }

            if (this._maxSize != null) {
                w = Math.min(w, this._maxSize[0]);
                h = Math.min(h, this._maxSize[1]);
            }

            w = Math.min(w, allowedSize[0]);
            h = Math.min(h, allowedSize[1]);

            let clipRect = null;

            if (this._sizeRequestedByChildren[0] <= w) {
                if (this._direction == Direction.HORIZONTAL) {
                    if (this._alignChildren == AlignChildren.END) {
                        childrenOffset[0] += w - this._sizeRequestedByChildren[0];
                    } else if (this._alignChildren == AlignChildren.CENTER) {
                        childrenOffset[0] += (w - this._sizeRequestedByChildren[0]) / 2;
                    }
                }
            } else {
                //console.log("got no spare w", this); 
                clipRect = [0, 0, w, h];

                // TODO: Horizontal scrolling
            }

     
            const hover = mouse && mouse.pos && contains([0, 0, w, h], mouse.pos);
            let scrollbar = null;

            if (this._sizeRequestedByChildren[1] <= h) {
                if (this._direction == Direction.VERTICAL) {
                    if (this._alignChildren == AlignChildren.END) {
                        childrenOffset[1] += h - this._sizeRequestedByChildren[1];
                    } else if (this._alignChildren == AlignChildren.CENTER) {
                        childrenOffset[1] += (h - this._sizeRequestedByChildren[1]) / 2;
                    }
                }
            } else {
                //console.log("got no spare h"); 
                clipRect = [0, 0, w, h];

                if (this._isVerticalScrollAllowed) {

                    const minScroll = 0;
                    const maxScroll = this._sizeRequestedByChildren[1] - h;

                    const scrollbarW = 15;
                    const scrollbarH = h*h/this._sizeRequestedByChildren[1];
    
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
                    scrollbar = [w - scrollbarW, scrollbarY, scrollbarW, scrollbarH];
                }
            }

            let allowedChildSize = [allowedSize[0], allowedSize[1]];
            if (scrollbar != null) {
                allowedChildSize[0] -= scrollbar[2];
            }
            if (this._maxSize != null) {
                if (this._direction == Direction.HORIZONTAL) {
                    allowedChildSize[1] = Math.min(allowedChildSize[1], this._maxSize[1]);
                } else {
                    assert(this._direction == Direction.VERTICAL);
                    allowedChildSize[0] = Math.min(allowedChildSize[0], this._maxSize[0]);
                }
            }
            allowedChildSize[0] -= this._padding[0] * 2;
            allowedChildSize[1] -= this._padding[1] * 2;

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

                let childClipRect = null;
                if (clipRect != null) {
                    childClipRect = [clipRect[0] - childX, clipRect[1] - childY, clipRect[2], clipRect[3]];
                    ctx.rect(...childClipRect);
                    ctx.clip();
                    //console.log("Clipped for child: ", clipRect[0] - childX, clipRect[1] - childY, clipRect[2], clipRect[3]); //TODO
                }
                
                let [childW, childH] = child.requestedSize(allowedChildSize);

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

    function contains([x, y, w, h], [x0, y0]) {
        return x0 > x && x0 < x + w && y0 > y && y0 < y + h;
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
        STATE.root.computeLayout();
        STATE.root.draw(STATE.ctx, [STATE.canvas.width, STATE.canvas.height], {...mouseEvent, pos: STATE.mousePos}, keydownEvent);
    }

    function getElementById(id) {
        assert(id != null);
        const element = STATE.elementsById[id];
        assert(element != null);
        return element;
    }

    return {
        attachUiToWindow,
        redraw,
        getElementById,
        Direction,
        AlignChildren,
        Container,
        TextContainer,
        TextInput,
        Button,
        SelectionList,
    };
}();
