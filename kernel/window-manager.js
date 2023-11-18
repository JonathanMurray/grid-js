
const ID_WINDOW_PREFIX = "program-window-";
const CLASS_WINDOW = "program-window";
const CLASS_HEADER = "program-window-header";
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

const MIN_SIZE = [200, 100];

const CANVAS_SCALE = window.devicePixelRatio; // Change to 1 on retina screens to see blurry canvas.

class WindowManager {

    constructor() {
        this.draggingWindow = null;
        this.maxZIndex = 1;
        this.windows = {};
        this.focusedWindow = null;
        this.hoveredResize = null;
        this.ongoingResize = null;

        this.isEasyAimEnabled = false;

        window.addEventListener("mousemove", (event) => {
            if (this.draggingWindow != null) {
                const {window, offset} = this.draggingWindow;
                window.element.style.left = event.x - offset[0];
                window.element.style.top = event.y - offset[1];
                this.focusWindow(window);
            } else if (this.ongoingResize != null) {
                const {window, anchor, offset} = this.ongoingResize;

                const rect = window.element.getBoundingClientRect();
                //const canvas = window.element.querySelector("canvas");
                const canvasWrapper = window.element.querySelector(".canvas-wrapper");
                let canvasRect = canvasWrapper.getBoundingClientRect();

                let newX;
                let newY;
                let newWidth;
                let newHeight;

                if (anchor.includes("N")) {
                    const targetY = event.y - offset[1];
                    const targetDY = targetY - rect.y;
                    newHeight = Math.max(canvasRect.height - targetDY, MIN_SIZE[1]);
                    const dy = canvasRect.height - newHeight;
                    newY = rect.y + dy;
                }
                if (anchor.includes("E")) {
                    const prevRight = rect.x + rect.width;
                    const newRight = event.x - offset[0];
                    const dx = newRight - prevRight;
                    newWidth = Math.max(canvasRect.width + dx, MIN_SIZE[0]);
                }
                if (anchor.includes("S")) {
                    const prevBot = rect.y + rect.height;
                    const newBot = event.y - offset[1];
                    const dy = newBot - prevBot;
                    newHeight = Math.max(canvasRect.height + dy, MIN_SIZE[1]);
                }
                if (anchor.includes("W")) {
                    const targetX = event.x - offset[0];
                    const targetDX = targetX - rect.x;
                    newWidth = Math.max(canvasRect.width - targetDX, MIN_SIZE[0]);
                    const dx = canvasRect.width - newWidth;
                    newX = rect.x + dx;
                } 

                if (newX != undefined) {
                    window.element.style.left = newX;
                }
                if (newY != undefined) {
                    window.element.style.top = newY;
                }
                if (newWidth != undefined) {
                    canvasWrapper.style.width = newWidth;
                    window.element.getElementsByClassName(CLASS_HEADER)[0].style.width = newWidth;
                }
                if (newHeight != undefined) {
                    canvasWrapper.style.height = newHeight;
                }

            }
        });

        window.addEventListener("mousedown", (event) => {
            // Mouse clicked on the desktop environment outside any of the windows
            this.unfocusWindow();
        });

        window.addEventListener("mouseup", (event) => {
            if (this.draggingWindow != null) {
                const {window} = this.draggingWindow;
                this.focusWindow(window);
                this.draggingWindow = null;
            }

            if (this.ongoingResize != null) {
                const window = this.ongoingResize.window;
                const canvasWrapper = window.element.querySelector(".canvas-wrapper");
                const canvas = window.element.querySelector("canvas");
                canvas.style.width = canvasWrapper.style.width;
                canvas.style.height = canvasWrapper.style.height;
                const canvasRect = canvas.getBoundingClientRect();
                const resizeEvent = {width: canvasRect.width * CANVAS_SCALE, height: canvasRect.height * CANVAS_SCALE};
                canvas.style.display = "none";
                this.sendInputToProcess(window, {name: "resize", event: resizeEvent});
                this.ongoingResize = null;
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
        
            if (event.key == "Control") {
                // default = Chrome menu takes focus
                event.preventDefault();
                
                this.enableEasyAim();
            }

            if (this.focusedWindow != null) {
                this.sendInputToProcess(this.focusedWindow, {name: "keydown", event: {key: event.key, ctrlKey: event.ctrlKey}});
            }
        });

        window.addEventListener("keyup", (event) => {
            if (event.key == "Control") {
                this.disableEasyAim();
            }
        })
    }

    onResizeDone(pid) {
        const canvas = this.windows[pid].element.querySelector("canvas");
        canvas.style.display = "block";
    }

    enableEasyAim() {
        document.querySelector("body").classList.add("cursor-move");
        this.isEasyAimEnabled = true;
    }

    disableEasyAim() {
        document.querySelector("body").classList.remove("cursor-move");
        this.isEasyAimEnabled = false;
    }

    sendInputToProcess(window, userInput) {
        window.worker.postMessage({userInput});
    }

    getWindow(pid) {
        return this.windows[pid];
    }

    getFrontMostWindow() {
        let maxZIndex = 0;
        let frontMost = null;
        for (let pid in this.windows) {
            const window = this.windows[pid];
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
            this.focusWindow(window);
        }
    }
    
    focusWindow(win) {
        for (let pid in this.windows) {
            const w = this.windows[pid];
            if (w != win) {
                w.element.classList.remove(CLASS_FOCUSED);
            }
        }

        const {element} = win;
        if (element.style.zIndex < this.maxZIndex) {
            element.style.zIndex = ++this.maxZIndex;
        }
    
        element.classList.add(CLASS_FOCUSED);

        this.focusedWindow = win;
    }

    unfocusWindow() {
        if (this.focusedWindow != null) {
            this.focusedWindow.element.classList.remove(CLASS_FOCUSED);
            this.focusedWindow = null;
        }
    }
    
    focusWindowByPid(pid) {
        const window = this.getWindow(pid);
        this.focusWindow(window);
    }

    clearResize() {
        for (let key in CURSOR_RESIZE_CLASS_NAMES) {
            const className = CURSOR_RESIZE_CLASS_NAMES[key];
            document.querySelector("body").classList.remove(className);
        }
        this.hoveredResize = null;
    }

    setHoveredResize(anchor, window) {
        const className = CURSOR_RESIZE_CLASS_NAMES[anchor];
        console.assert(className != undefined);

        this.clearResize();
        document.querySelector("body").classList.add(className);
        this.hoveredResize = {window, anchor};
    }

    renderTemplate(template, args) {
        const regex = /{{([a-z]+)}}/;
        for (let i = 0; i < 100; i ++) {
            const match = template.match(regex);
            if (match == null) {
                console.log("RENDERED: ", template);
                return template;
            }

            template = template.replace(match[0], args[match[1]]);
        }
        console.error("Didn't render the entire template: ", template);
    }

    async fetchAndRenderTemplate(url, args) {
        const response = await fetch(url);
        const template = await response.text();
        const rendered = this.renderTemplate(template, args)
        const parser = new DOMParser();
        const doc = parser.parseFromString(rendered, 'text/html');
        return doc;
    }

    positionNewWindow(width, height) {
        const frontMost = this.getFrontMostWindow();
        if (frontMost && frontMost.element.style && frontMost.element.style.left) {
            const offset = 25;
            return [parseInt(frontMost.element.style.left.replace("px", "")) + offset,
                    parseInt(frontMost.element.style.top.replace("px", "")) + offset];
        } else {
            const availableScreenSpace = document.getElementsByTagName("body")[0].getBoundingClientRect()
            return [availableScreenSpace.width / 2 - width / 2,
                    availableScreenSpace.height / 2 - height / 2];
        }
    }

    async createWindow(title, [width, height], proc, resizable) {
        const pid = proc.pid;
        title = `[${pid}] ${title || "Untitled"}`

        const doc = await this.fetchAndRenderTemplate("/kernel/window-template.html", {pid, title, width, height});

        const winElement = doc.querySelector('.program-window');
        const win = {element: winElement, worker: proc.worker}

        const canvasWrapper = winElement.querySelector(".canvas-wrapper");
        const canvas = winElement.querySelector("canvas");
        const styleSize = [`${width / CANVAS_SCALE}px`, `${height / CANVAS_SCALE}px`];
        canvasWrapper.style.width = styleSize[0];
        canvasWrapper.style.height = styleSize[1];
        canvas.style.width = styleSize[0];
        canvas.style.height = styleSize[1];
        
        winElement.addEventListener("mousedown", (event) => {
            const left = winElement.getBoundingClientRect().x;
            const top =  winElement.getBoundingClientRect().y;
            if (this.isEasyAimEnabled && this.hoveredResize == null) {
                this.draggingWindow = {window: win, offset: [event.x - left, event.y - top]};
            }
            this.focusWindow(win);

            if (this.hoveredResize && this.hoveredResize.window == win) {
                const anchor = this.hoveredResize.anchor;
                this.hoveredResize = null;
                const rect = winElement.getBoundingClientRect();

                let offset = [0, 0];
                if (anchor.includes("N")) {
                    offset[1] = event.y - rect.y;
                } else if (anchor.includes("E")) {
                    offset[0] = event.x - (rect.x + rect.width);
                } else if (anchor.includes("S")) {
                    offset[1] = event.y - (rect.y + rect.height);
                } else if (anchor.includes("W")) {
                    offset[0] = event.x - rect.x;
                }

                this.ongoingResize = {window: win, anchor, offset};
            }

            // Prevent window manager from taking focus from the window
            event.stopPropagation();
        });

        winElement.addEventListener("mousemove", (event) => {
            if (this.draggingWindow == null && this.ongoingResize == null) {
                const rec = winElement.getBoundingClientRect();
                const x = event.x - rec.x;
                const y = event.y - rec.y;
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

        const header = winElement.querySelector(".program-window-header");
        header.addEventListener("mousedown", (event) => {
            if (this.hoveredResize == null) {
                const left = parseInt(winElement.style.left.replace("px", "")) || winElement.getBoundingClientRect().x;
                const top = parseInt(winElement.style.top.replace("px", "")) || winElement.getBoundingClientRect().y;
                this.draggingWindow = {window: win, offset: [event.x - left, event.y - top]};
            }
        });

        // User input to process
        canvas.addEventListener("mousemove", (event) => {
            event = {x: event.offsetX * CANVAS_SCALE, y: event.offsetY * CANVAS_SCALE};
            this.sendInputToProcess(win, {name: "mousemove", event});
        });
        canvas.addEventListener("mouseout", (event) => {
            this.sendInputToProcess(win, {name: "mouseout", event: {}});
        });
        canvas.addEventListener("click", (event) => {
            event = {x: event.offsetX * CANVAS_SCALE, y: event.offsetY * CANVAS_SCALE};
            this.sendInputToProcess(win, {name: "click", event});
        });
    
        document.querySelector("body").appendChild(winElement);

        const rect = winElement.getBoundingClientRect();
        const position = this.positionNewWindow(rect.width, rect.height);
        winElement.style.left = position[0];
        winElement.style.top = position[1];
    
        this.focusWindow(win);

        this.windows[pid] = win;
        console.log("Added window. ", this.windows);

        const offscreenCanvas = canvas.transferControlToOffscreen();
        return offscreenCanvas;
    }
    
    removeWindowIfExists(pid) {
        const win = this.getWindow(pid);
        if (win) {
            delete this.windows[pid];
            win.element.remove();
            console.log("Removed window. ", this.windows);
        }

    }
}
