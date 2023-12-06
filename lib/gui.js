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
        constructor(ctx, text, {color = "white", font = "18px monospace"} = {}) {
            this._ctx = ctx;
            this._text = text;
            this._color = color;
            this._font = font;

            this.computeLayout();

            this._parent = null;
        }

        _setFont() {
            if (this._font != null) {
                this._ctx.font = this._font;
            }
        }

        computeLayout() {
            this._setFont();
            const metrics = this._ctx.measureText(this._text);
            this._size = [metrics.width, metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent];
            this._textPosition = [0, metrics.fontBoundingBoxAscent];

            if (this._parent != null) {
                this._parent.computeLayout();
            }
        }

        setText(text) {
            this._text = text;
            this.computeLayout();
        }

        appendText(text) {
            this._text += text;
            this.computeLayout();
        }

        setParent(parent) {
            this._parent = parent;
        }

        demandedSize() {
            return this._size;
        }

        draw(ctx, _allowedSize, _mouse, {textColor=null} = {}) {
            this._setFont();
            ctx.fillStyle = textColor || this._color;
            ctx.fillText(this._text, this._textPosition[0], this._textPosition[1]);
        }
    }

    class TextInput {
        constructor(ctx, text, {minSize = [100, 0], padding = [5, 5], borderColor = "white", bg = "#444"} = {}) {
            this._textContainer = new TextContainer(ctx, text);
            this._inner = new Container({minSize, bg, borderColor, borderWidth: 1, padding});
            this._inner.addChild(this._textContainer);
        }

        setParent(parent) {
            this._inner.setParent(parent);
        }

        computeLayout() {
            assert(false, "Should never be called, since this element has no children");
        }

        demandedSize() {
            return this._inner.demandedSize();
        }

        draw(ctx, allowedSize, mouse) {
            this._inner.draw(ctx, allowedSize, mouse, {});
        }

        setText(text) {
            this._textContainer.setText(text);
        }

        appendText(text) {
            this._textContainer.appendText(text);
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

        demandedSize() {
            return this._inner.demandedSize();
        }

        draw(ctx, allowedSize, mouse) {
            const [w, h] = this._inner.demandedSize();

            let overrides = {};
            if (mouse && mouse.pos && contains([0, 0, w, h], mouse.pos)) {
                overrides.textColor = "yellow";
                overrides.bgColor = "#777";
                overrides.borderColor = "#CCC";
                if (this._onClick != null && mouse.changedToDown) {
                    this._onClick();
                }
            }

            this._inner.draw(ctx, allowedSize, mouse, overrides);
        }
    }

    
    class SelectionList {
        constructor(container, onSelection) {
            this._container = container;
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

        demandedSize() {
            return this._container.demandedSize();
        }

        draw(ctx, allowedSize, mouse, overrides={}) {
            this._container.draw(ctx, allowedSize, mouse, overrides);
        }

        addItem(item) {
            const itemIndex = this._itemCount;
            const itemContainer = new Container({hoverBg: "#666", stretch: true, onClick: () => {this._onSelection(itemIndex)}});
            itemContainer.addChild(item);
            this._container.addChild(itemContainer);
            this._itemCount ++;
            return this;
        }
    }

    class Container {
        constructor({
            bg = null,
            hoverBg = null,
            cornerRadius = null,
            borderWidth = 1,
            borderColor = null,
            hoverBorderColor = null,
            minSize = [0, 0],
            maxSize = null,
            direction = Direction.HORIZONTAL,
            padding = null,
            stretch=false,
            align=AlignChildren.START,
            onClick=null,
            verticalScroll=false,
        } = {}) {
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
            this._stretch = stretch;
            this._alignChildren = align;
            this._onClick = onClick;

            this._children = [];
            this._childrenMinSize = null;
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

            for (let widget of this._children) {
                const [childW, childH] = widget.demandedSize();

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

            this._childrenMinSize = [rightX, bottomY];

            if (this._parent != null) {
                this._parent.computeLayout();
            }
        }

        demandedSize() {
            if (this._childrenMinSize == null) {
                // The element has no children, which is equivalent to having 0-sized children
                this._childrenMinSize = [0, 0];
            }

            let [w, h] = [Math.max(this._childrenMinSize[0], this._minSize[0]),
                        Math.max(this._childrenMinSize[1], this._minSize[1])];

            if (this._maxSize != null) {
                // even if children demand more space, we refuse to grow beyond our max size

                //console.log("Children min size: ", this._childrenMinSize, " but container max size: ", this._maxSize); //TODO

                w = Math.min(w, this._maxSize[0]);
                h = Math.min(h, this._maxSize[1]);
            }

            return [w, h];
        }

        draw(ctx, allowedSize, mouse, overrides={}) {
            if (this._children.length > 1) {
                //console.log("Draw, ", this); //TODO
            }

            if (mouse.changedToUp) {
                this._draggingScrollbar = null;
            }

            let [w, h] = this.demandedSize();

            let childrenOffset = [0, -this._yScrollAmount];

            if (this._stretch) {
                if (allowedSize[0] != null) {
                    w = Math.max(w, allowedSize[0]);
                }
                if (allowedSize[1] != null) {
                    h = Math.max(h, allowedSize[1]);
                }
            }

            if (this._childrenMinSize[0] <= w) {
                if (this._direction == Direction.HORIZONTAL) {
                    if (this._alignChildren == AlignChildren.END) {
                        childrenOffset[0] += w - this._childrenMinSize[0];
                    } else if (this._alignChildren == AlignChildren.CENTER) {
                        childrenOffset[0] += (w - this._childrenMinSize[0]) / 2;
                    }
                }
            }

            let clipRect = null;

            let scrollbar = null;

            if (this._childrenMinSize[1] <= h) {
                if (this._direction == Direction.VERTICAL) {
                    if (this._alignChildren == AlignChildren.END) {
                        childrenOffset[1] += h - this._childrenMinSize[1];
                    } else if (this._alignChildren == AlignChildren.CENTER) {
                        childrenOffset[1] += (h - this._childrenMinSize[1]) / 2;
                    }
                }
            } else {
                //console.log("got no spare h"); //TODO
                clipRect = [0, 0, w, h];
                
          

                if (this._isVerticalScrollAllowed) {

                    const minScroll = 0;
                    const maxScroll = this._childrenMinSize[1] - h;

                    const scrollbarW = 15;
                    const scrollbarH = h*h/this._childrenMinSize[1];
    
                    if (mouse && mouse.scrollDelta != undefined) {
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
                // (this._childrenMinSize[1] - h) *

            }
            
            const hover = mouse && mouse.pos && contains([0, 0, w, h], mouse.pos);

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
            if (borderColor != null) {
                ctx.strokeStyle = borderColor;
                ctx.lineWidth = this._borderWidth;
                ctx.stroke();
            }

            let childX = childrenOffset[0] + this._padding[0];
            let childY = childrenOffset[1] + this._padding[1];
            for (let widget of this._children) {
                ctx.save();
                ctx.translate(childX, childY);


                let childClipRect = null;
                if (clipRect != null) {
                    childClipRect = [clipRect[0] - childX, clipRect[1] - childY, clipRect[2], clipRect[3]];
                    ctx.rect(...childClipRect);
                    ctx.clip();
                    //console.log("Clipped for child: ", clipRect[0] - childX, clipRect[1] - childY, clipRect[2], clipRect[3]); //TODO
                }

                const [childW, childH] = widget.demandedSize();

                let allowedChildSize = [null, null];
                if (this._direction == Direction.HORIZONTAL) {
                    allowedChildSize[1] = h - this._padding[1] * 2;
                } else {
                    assert(this._direction == Direction.VERTICAL);
                    allowedChildSize[0] = w - this._padding[0] * 2;
                }

                if (scrollbar != null) {
                    allowedChildSize[0] -= scrollbar[2];
                }

                //console.log("allowed child size: ", allowedChildSize); //TODO

                let isChildVisible = true;
                if (childClipRect != null) {
                    isChildVisible = childClipRect[1] < childH && childClipRect[1] + childClipRect[3] > 0;
                }

                if (isChildVisible) {
                    widget.draw(ctx, allowedChildSize, convertMousePosition(mouse, [childX, childY]), overrides);
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
                        console.log("SCROLL FROM ", this._draggingScrollbar);
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

        }
    }

    class GuiManager {
        constructor(window, ctx, rootElement) {

            this._mousePos = [-1, -1];
            this._ctx = ctx;
            this._root = rootElement;
            this._size = [window.canvas.width, window.canvas.height];

            window.addEventListener("mousemove", (event) => {
                this._mousePos = [event.x, event.y];
                this.redraw();
            });
            window.addEventListener("mousedown", (event) => {
                this.redraw({changedToDown: true});
            });
            window.addEventListener("mouseup", (event) => {
                this.redraw({changedToUp: true});
            });
            window.addEventListener("wheel", (event) => {
                this.redraw({scrollDelta: event.deltaY});
                this.redraw();
            });

            this.redraw();
        }


        redraw(mouseEvent={}) {
            this._ctx.resetTransform();
            this._root.draw(this._ctx, this._size, {...mouseEvent, pos: this._mousePos});
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

    return {
        GuiManager,
        Direction,
        AlignChildren,
        Container,
        TextContainer,
        TextInput,
        Button,
        SelectionList,
    };
}();
