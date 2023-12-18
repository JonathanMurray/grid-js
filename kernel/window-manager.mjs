// @ts-ignore
import Mustache from "https://cdnjs.cloudflare.com/ajax/libs/mustache.js/4.2.0/mustache.js";
import { FileType, assert } from "../shared.mjs";
import { SysError, Errno } from "./errors.mjs";
import { WaitQueues } from "./wait-queues.mjs";

const CLASS_FOCUSED = "focused";

const CURSOR_RESIZE_CLASS_NAMES = {
    "NE": "cursor-ne-resize",
    "SE": "cursor-se-resize",
    "SW": "cursor-sw-resize",
    "NW": "cursor-nw-resize",
    "N": "cursor-n-resize",
    "E": "cursor-e-resize",
    "S": "cursor-s-resize",
    "W": "cursor-w-resize",
}

const WIN_MIN_SIZE = [200, 100];

const PROGRAM_LAUNCHER = "/bin/launcher2";

const CANVAS_SCALE = window.devicePixelRatio; // Change to 1 on retina screens to see blurry canvas.

function rectInPage(element) {
    // The bounding client rect is not an elements position "on the page". For example, if you scroll down
    // the bounding rect will get a lower y value (because it's shown further up on the screen). 
    const r = element.getBoundingClientRect();

    return {x: window.scrollX + r.x , y: window.scrollY + r.y, width: r.width, height: r.height};
}

 /**
  * Work-around for "Object is possibly 'null'" and no !-operator in vanilla js
  * @returns {HTMLElement | null} 
  * */
 function findElement(element, selector) {
    return element.querySelector(selector);
}

/**
  * @returns {HTMLElement} 
  */
function asHtmlElement(htmlElement) {
    return htmlElement;
}

export class WindowManager {

    static async init(launchProgram) {
        const screenArea = await WindowManager.render("screen-area.mustache");
        document.querySelector("body").appendChild(screenArea);
        return new WindowManager(screenArea, launchProgram);
    }

    constructor(screenArea, spawnProgram) {
        this.screenArea = screenArea;
        this.spawnProgram = spawnProgram;

        this._procSockets = {};

        this.draggingWindow = null;
        this.maxZIndex = 1;
        this._windows = {};
        this.hoveredResize = null;
        this.ongoingResize = null;

        this.focused = null;

        this.isEasyAimEnabled = false;

        this.screenRect = rectInPage(screenArea);

        
        this.dock = findElement(document, "#dock");
        this.dockHeight = this.dock.getBoundingClientRect().height;
        findElement(document, "#launcher-icon").addEventListener("mousedown", (event) => {
            this.showLauncher();

            // Prevent window manager from taking focus from the launcher
            event.stopPropagation();
        });

        const minVisible = 40;

        window.addEventListener("mousemove", (event) => {
            const {mouseX, mouseY} = this.translateMouse(event);
            if (this.draggingWindow != null) {
                const {window, offset} = this.draggingWindow;
                const rect = this.rectWithinScreenArea(window.element);
                let newX = mouseX - offset[0];
                let newY = mouseY - offset[1];

                // Don't let the window be dragged completely out of the screen area
                newX = Math.max(newX, minVisible - rect.width); // left side
                newX = Math.min(newX, this.screenRect.width - minVisible); // right side
                newY = Math.max(newY, minVisible - rect.height); // top side
                newY = Math.min(newY, this.screenRect.height - this.dockHeight - minVisible); // bottom side

                window.element.style.left = newX.toString();
                window.element.style.top = newY.toString();
                this.setFocused({window})
            } else if (this.ongoingResize != null) {
                const {window, anchor, offset} = this.ongoingResize;

                const rect = this.rectWithinScreenArea(window.element);
                const canvasWrapper = findElement(window.element, ".canvas-wrapper");
                const canvasRect = this.rectWithinScreenArea(canvasWrapper);

                let newX;
                let newY;
                let newWidth;
                let newHeight;

                if (anchor.includes("W")) {
                    const targetX = Math.max(mouseX - offset[0], 0);
                    const targetDX = targetX - rect.x;
                    // Don't allow making the window too small
                    newWidth = Math.max(canvasRect.width - targetDX, WIN_MIN_SIZE[0]);
                    // Don't allow dragging out through the right screen edge, making the window disappear
                    newWidth = Math.max(newWidth, rect.x + canvasRect.width - this.screenRect.width + minVisible);
                    const dx = canvasRect.width - newWidth;
                    newX = rect.x + dx;
                } 
                if (anchor.includes("N")) {
                    const targetY = Math.max(mouseY - offset[1], 0);
                    const targetDY = targetY - rect.y;
                    // Don't allow making the window too small
                    newHeight = Math.max(canvasRect.height - targetDY, WIN_MIN_SIZE[1]);
                    // Don't allow dragging out of the bottom screen edge, making the window disappear
                    newHeight = Math.max(newHeight, this.dockHeight + rect.y + canvasRect.height - this.screenRect.height + minVisible);
                    const dy = canvasRect.height - newHeight;
                    newY = rect.y + dy;
                }
                if (anchor.includes("E")) {
                    const prevRight = rect.x + rect.width;
                    const newRight = Math.min(mouseX - offset[0], this.screenRect.width);
                    const dx = newRight - prevRight;
                    newWidth = Math.max(canvasRect.width + dx, WIN_MIN_SIZE[0]);
                }
                if (anchor.includes("S")) {
                    const prevBot = rect.y + rect.height;
                    const newBot = Math.min(mouseY - offset[1], this.screenRect.height);
                    const dy = newBot - prevBot;
                    newHeight = Math.max(canvasRect.height + dy, WIN_MIN_SIZE[1]);
                }
       

                if (newX != undefined) {
                    window.element.style.left = newX.toString();
                }
                if (newY != undefined) {
                    window.element.style.top = newY.toString();
                }
                if (newWidth != undefined) {
                    canvasWrapper.style.width = `${newWidth}px`;
                    const titlebar = findElement(window.element, ".titlebar");
                    const padding = Number.parseInt(titlebar.style.paddingLeft.replace("px", ""));
                    titlebar.style.width = `${newWidth - padding}px`;
                }
                if (newHeight != undefined) {
                    canvasWrapper.style.height = `${newHeight}px`;
                }

            }
        });

        window.addEventListener("mousedown", (event) => {
            // Mouse clicked on the desktop environment outside any of the windows
            this.setFocused(null);
        });

        window.addEventListener("mouseup", (event) => {
            if (this.draggingWindow != null) {
                const {window} = this.draggingWindow;
                this.setFocused({window});
                this.draggingWindow = null;
            }

            if (this.ongoingResize != null) {
                const window = this.ongoingResize.window;
                const canvasWrapper = findElement(window.element, ".canvas-wrapper");
                const canvas = findElement(window.element, "canvas");
                canvas.style.width = canvasWrapper.style.width;
                canvas.style.height = canvasWrapper.style.height;
                const canvasRect = this.rectWithinScreenArea(canvas);
                const resizeEvent = {width: canvasRect.width * CANVAS_SCALE, height: canvasRect.height * CANVAS_SCALE};
                canvas.style.display = "none"; // Hide during resize to reduce glitching
                this.sendInputToProcess(window, {name: "windowWasResized", event: resizeEvent});
                this.ongoingResize = null;
            }

            if (this.focused != null && "window" in this.focused) {
                this.sendInputToProcess(this.focused.window, {name: "mouseup", event: null});
            }
        });

        window.addEventListener("keydown", (event) => {

            if (event.code == "Tab") {
                // default = focus is moved
                event.preventDefault();
            }
        
            if (event.key == "s" && event.ctrlKey) {
                // default = save webpage
                event.preventDefault();
            }

            if (event.key == "o" && event.ctrlKey) {
                // default = open file
                event.preventDefault();
            }

            if (event.key == "d" && event.ctrlKey) {
                // default = Chrome edit bookmark
                event.preventDefault();
            }

            if (["-", "+"].includes(event.key) && event.ctrlKey) {
                // default = zoom webpage
                event.preventDefault();
            }
            if (event.key == "Control") {
                // default = Chrome menu takes focus
                event.preventDefault();
                
                this.enableEasyAim();
            }

            if (this.focused != null && "window" in this.focused) {
                this.sendInputToProcess(this.focused.window, {name: "keydown", event: {key: event.key, ctrlKey: event.ctrlKey}});
            }
        });

        window.addEventListener("keyup", (event) => {
            if (event.key == "Control") {
                this.disableEasyAim();
            }
        })
    }

    showLauncher() {
        for (let pid in this._windows) {
            const win = this._windows[pid];
            if (win.process.programName == PROGRAM_LAUNCHER) {
                this.setFocused({window: win});
                return;
            }
        }
        this.spawnProgram(PROGRAM_LAUNCHER);
    }

    rectWithinScreenArea(element) {
        const rect = rectInPage(element);
        return {x: rect.x - this.screenRect.x, y: rect.y - this.screenRect.y, width: rect.width, height: rect.height};
    }

    _onResizeDone(pid) {
        const canvas = this._windows[pid].element.querySelector("canvas");
        canvas.style.display = "block";
    }

    enableEasyAim() {
        this.screenArea.classList.add("cursor-move");
        this.isEasyAimEnabled = true;
    }

    disableEasyAim() {
        this.screenArea.classList.remove("cursor-move");
        this.isEasyAimEnabled = false;
    }

    sendInputToProcess(window, userInput) {
        const socket = this._procSockets[window.process.pid];
        assert(socket != null);

        socket._addOutgoingMessage(userInput);
    }

    getWindow(pid) {
        return this._windows[pid];
    }

    getFrontMostWindow() {
        let maxZIndex = 0;
        let frontMost = null;
        for (let pid in this._windows) {
            const window = this._windows[pid];
            if (window.element.style.zIndex > maxZIndex) {
                maxZIndex = window.element.style.zIndex;
                frontMost = window;
            }
        }
        return frontMost;
    }
    
    focusFrontMostWindow() {
        const window = this.getFrontMostWindow();
        if (window) {
            this.setFocused({window: window});
        }
    }

    setFocused(newFocused) {
        if (this.focused != null) {
            if ("window" in this.focused) {
                const {element} = this.focused.window;
                const isStillFocused = newFocused && "dropdown" in newFocused && element.contains(newFocused.dropdown);
                if (!isStillFocused) {
                    element.classList.remove(CLASS_FOCUSED);
                    document.querySelectorAll(".dock-item").forEach((item) => item.classList.remove("focused"));
                }
            } else if ("dropdown" in this.focused) {
                this.focused.dropdown.classList.remove("active");
            } else {
                assert(false);
            }
        }

        if (newFocused != null) {
            if ("window" in newFocused) {
                const {element, process} = newFocused.window;
                const pid = process.pid;
                findElement(document, `#dock-item-${pid}`).classList.add("focused");
                if (element.style.zIndex < this.maxZIndex) {
                    element.style.zIndex = ++this.maxZIndex;
                }
                element.classList.add(CLASS_FOCUSED);
            } else if ("dropdown" in newFocused) {
                newFocused.dropdown.classList.add("active");
            } else {
                assert(false);
            }
        }

        this.focused = newFocused;
    }

    clearResize() {
        for (let key in CURSOR_RESIZE_CLASS_NAMES) {
            const className = CURSOR_RESIZE_CLASS_NAMES[key];
            this.screenArea.classList.remove(className);
        }
        this.hoveredResize = null;
    }

    setHoveredResize(anchor, window) {
        const className = CURSOR_RESIZE_CLASS_NAMES[anchor];
        assert(className != undefined);

        this.clearResize();
        this.screenArea.classList.add(className);
        this.hoveredResize = {window, anchor};
    }

    /**
     * @returns {Promise<HTMLElement>}
     */
    static async render(fileName, args) {
        const url = `kernel/html/${fileName}`;
        const response = await fetch(url);
        const mustacheTemplate = await response.text();
        const html = Mustache.render(mustacheTemplate, args);
        const template = document.createElement('template');
        template.innerHTML = html;
        // @ts-ignore
        return template.content.children[0];
    }

    positionNewWindow(width, height) {

        const frontMost = this.getFrontMostWindow();
        if (frontMost && frontMost.element.style && frontMost.element.style.left) {
            const offset = 25;
            return [parseInt(frontMost.element.style.left.replace("px", "")) + offset,
                    parseInt(frontMost.element.style.top.replace("px", "")) + offset];
        } else {
            return [this.screenRect.width / 2 - width / 2, this.screenRect.height / 2 - height / 2];
        }
    }

    async setupGraphics(proc, title, size, resizable, menubarItems) {
        const socketFile = new GraphicsSocketFile(this, proc);
        this._procSockets[proc.pid] = socketFile;
        const canvas = await this._createWindow(title, size, proc, resizable, menubarItems);
        return {socketFile, canvas};
    }

    async _createWindow(title, [width, height], proc, resizable, menubarItems) {
        const pid = proc.pid;
        title = `${title} (pid=${pid})`

        const winElement = await WindowManager.render("window.mustache", {pid, title, width, height});

        const win = {element: winElement, process: proc};

       
    
        const canvasWrapper = findElement(winElement, ".canvas-wrapper");
   
        const canvas = findElement(winElement, "canvas");
        const styleSize = [`${width / CANVAS_SCALE}px`, `${height / CANVAS_SCALE}px`];
        canvasWrapper.style.width = styleSize[0];
        canvasWrapper.style.height = styleSize[1];
        canvas.style.width = styleSize[0];
        canvas.style.height = styleSize[1];

        winElement.addEventListener("mousedown", (event) => {
            const {mouseX, mouseY} = this.translateMouse(event);
            const rect = this.rectWithinScreenArea(winElement);
            if (this.isEasyAimEnabled && this.hoveredResize == null) {
                this.draggingWindow = {window: win, offset: [mouseX - rect.x, mouseY - rect.y]};
            }
            this.setFocused({window: win});


            if (this.hoveredResize && this.hoveredResize.window == win) {


                const anchor = this.hoveredResize.anchor;
                this.hoveredResize = null;

                let offset = [0, 0];
                if (anchor.includes("N")) {
                    offset[1] = mouseY - rect.y;
                }
                if (anchor.includes("E")) {
                    offset[0] = mouseX - (rect.x + rect.width);
                } 
                if (anchor.includes("S")) {
                    offset[1] = mouseY - (rect.y + rect.height);
                } 
                if (anchor.includes("W")) {
                    offset[0] = mouseX - rect.x;
                }


                this.ongoingResize = {window: win, anchor, offset};
            }

            // Prevent window manager from taking focus from the window
            event.stopPropagation();
        });

        winElement.addEventListener("mousemove", (event) => {
            const {mouseX, mouseY} = this.translateMouse(event);
            if (this.draggingWindow == null && this.ongoingResize == null) {
                const rect = this.rectWithinScreenArea(winElement);
                const x = mouseX - rect.x;
                const y = mouseY - rect.y;
                const margin = this.isEasyAimEnabled ? 30 : 5;

                let anchor = "";
                if (y < margin) {
                    anchor += "N";
                }
                if (y > winElement.offsetHeight - margin) {
                    anchor += "S";
                }
                if (x < margin) {
                    anchor += "W";
                }
                if (x > winElement.offsetWidth - margin) {
                    anchor += "E";
                }

                if (anchor && resizable) {
                    this.setHoveredResize(anchor, win);
                } else {
                    this.clearResize();
                }
            }
        });

        const closeButton = findElement(winElement, ".titlebar-button");
        closeButton.addEventListener("mousedown", (event) => {
            // Prevent drag
            event.stopPropagation();
        });
        closeButton.addEventListener("click", (event) => {
            this.sendInputToProcess(win, {name: "closeWasClicked"});
        });

        const menubar = findElement(winElement, ".menubar");
        
        for (let itemConfig of menubarItems) {
            const {text, id} = itemConfig;

            if ("dropdown" in itemConfig) {
                const wrapper = await WindowManager.render(
                    "menubar-dropdown.mustache", 
                    {buttonId: id, text, items: itemConfig.dropdown}
                );
                const dropdown = wrapper.querySelector(".dropdown");
                const button = findElement(wrapper, ".menubar-button");
                menubar.appendChild(wrapper);

                for (let item of wrapper.querySelectorAll(".dropdown-item")) {
                    item.addEventListener("mousedown", (event) => {
                        this.setFocused(null);
                        const itemId = asHtmlElement(item).dataset.itemId;
                        this.sendInputToProcess(win, {name: "menubarDropdownItemWasClicked", event: {itemId}});
                        event.stopPropagation();
                    });
                }

                button.addEventListener("mousedown", (event) => {
                    if (this.focused != null && "dropdown" in this.focused) {
                        this.setFocused(null);
                    } else {
                        this.setFocused({dropdown});
                    }
    
                    event.stopPropagation(); // Don't let the window steal focus
                });
                button.addEventListener("mouseover", (event) => {
                    if (this.focused != null && "dropdown" in this.focused) {
                        this.setFocused({dropdown});
                    }
                });
            } else {
                const button = await WindowManager.render("menubar-button.mustache", {buttonId: id, text});
                menubar.appendChild(button);
                button.addEventListener("click", (event) => {
                    const button = asHtmlElement(event.target);
                    const buttonId = button.dataset.buttonId;
                    this.sendInputToProcess(win, {name: "menubarButtonWasClicked", event: {buttonId}});
                });
            }
        }

        const titlebar = findElement(winElement, ".titlebar");
        titlebar.addEventListener("mousedown", (event) => {
            const {mouseX, mouseY} = this.translateMouse(event);
            if (this.hoveredResize == null) {
                const rect = this.rectWithinScreenArea(winElement);
                const left = parseInt(winElement.style.left.replace("px", "")) || rect.x;
                const top = parseInt(winElement.style.top.replace("px", "")) || rect.y;
                this.draggingWindow = {window: win, offset: [mouseX - left, mouseY - top]};
            }
        });

        // User input to process
        canvas.addEventListener("mousemove", (event) => {
            const mousemove = {x: event.offsetX * CANVAS_SCALE, y: event.offsetY * CANVAS_SCALE};
            this.sendInputToProcess(win, {name: "mousemove", event: mousemove});
        });
        canvas.addEventListener("mouseout", (event) => {
            this.sendInputToProcess(win, {name: "mouseout", event: {}});
        });
        canvas.addEventListener("click", (event) => {
            const click = {x: event.offsetX * CANVAS_SCALE, y: event.offsetY * CANVAS_SCALE};
            this.sendInputToProcess(win, {name: "click", event: click});
        });
        canvas.addEventListener("mousedown", (event) => {
            const mousedown = {x: event.offsetX * CANVAS_SCALE, y: event.offsetY * CANVAS_SCALE};
            this.sendInputToProcess(win, {name: "mousedown", event: mousedown});
        });
        canvas.addEventListener(
            "wheel", 
            (event) => {
                const wheel = {deltaY: event.deltaY};
                this.sendInputToProcess(win, {name: "wheel", event: wheel});
            }, 
            // "passive" fixes warning log: https://chromestatus.com/feature/5745543795965952
            {passive:true}
        );
    
        this.screenArea.appendChild(winElement);

        const rect = this.rectWithinScreenArea(winElement);
        const position = this.positionNewWindow(rect.width, rect.height);
        winElement.style.left = position[0].toString();
        winElement.style.top = position[1].toString();

        // Now that the window is part of the DOM, we can calculate and set dropdown positions
        for (let dropdownWrapper of winElement.querySelectorAll(".dropdown-wrapper")) {
            const windowX = rectInPage(winElement).left;
            const buttonX = rectInPage(dropdownWrapper).left;
            findElement(dropdownWrapper, ".dropdown").style.left = `${buttonX - windowX}px`;
        }

        let programName = win.process.programName;
        programName = programName.slice(programName.lastIndexOf("/") + 1);
        const dockItem = await WindowManager.render("dock-item.mustache", {pid, programName});
        dockItem.addEventListener("mousedown", (event) => {
            this.setFocused({window: win});

             // Prevent window manager from taking focus from the window
             event.stopPropagation();
        });
        this.dock.appendChild(dockItem);

        this.setFocused({window: win});

        this._windows[pid] = win;
        console.log("Added window. ", this._windows);
        
        // @ts-ignore
        const offscreenCanvas = canvas.transferControlToOffscreen();
        return offscreenCanvas;
    }

    removeWindowIfExists(pid) {
        const win = this.getWindow(pid);
        if (win) {
            delete this._windows[pid];
            win.element.remove();
            console.log("Removed window. ", this._windows);

            const dockItem = findElement(document, `#dock-item-${pid}`);
            assert(dockItem, `dock item must exist, pid=${pid}`);
            dockItem.remove();
        }

        this.focusFrontMostWindow();
    }

    translateMouse(event) {
        return {mouseX: event.pageX - this.screenRect.x, mouseY: event.pageY - this.screenRect.y};
    }
}

class GraphicsSocketFile {
    constructor(windowManager, process) {
        this._windowManager = windowManager;
        this._process = process;

        this._isOpen = true;
        this._outgoingMessages = [];
        this._waitingReaders = [];
        this._waitingPollers = [];

        this._waitQueues = new WaitQueues();
        this._waitQueues.addQueue("outgoing");
    }

    open() {
    }

    close() {
        assert(this._isOpen);
        this._isOpen = false;
    }

    async writeAt(_charIdx, text) {
        assert(this._isOpen);
        let request;
        try {
            request = JSON.parse(text);
        } catch (e) {
            this._addOutgoingMessage({error: `Malformed request: ${e}`});
            return;
        }

        if ("resizeDone" in request) {
            this._windowManager._onResizeDone(this._process.pid);
        } else {
            assert(false, "Unhandled graphics request: ", request);   
        }
    }

    _addOutgoingMessage(msg) {
        this._outgoingMessages.push(msg);
        this._waitQueues.wakeup("outgoing");
    }
    
    async readAt(_charIdx) {
        assert(this._isOpen);

        await this._waitQueues.waitFor("outgoing", () => this._outgoingMessages.length > 0);

        const text = JSON.stringify(this._outgoingMessages);
        this._outgoingMessages = [];
        return text;
    }

    seek() {
        throw new SysError("cannot seek graphics socket", Errno.SPIPE);
    }

    getStatus() {
        return {
            type: FileType.SOCKET
        };
    }

    async pollRead() {
        await this._waitQueues.waitFor("outgoing", () => this._outgoingMessages.length > 0);
    }
}