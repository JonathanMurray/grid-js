
const ID_WINDOW_PREFIX = "program-window-";
const CLASS_WINDOW = "program-window";
const CLASS_TITLEBAR = "titlebar";
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

const PROGRAM_LAUNCHER = "launcher";

const CANVAS_SCALE = window.devicePixelRatio; // Change to 1 on retina screens to see blurry canvas.

class WindowManager {

    static async init(launchProgram) {
        const doc = await WindowManager.fetchAndRenderTemplate("kernel/html/screen-area.html");
        const screenArea = doc.querySelector("#screen-area");
        document.querySelector("body").appendChild(screenArea);
        return new WindowManager(screenArea, launchProgram);
    }

    constructor(screenArea, spawnProgram) {
        this.screenArea = screenArea;
        this.spawnProgram = spawnProgram;

        this.draggingWindow = null;
        this.maxZIndex = 1;
        this.windows = {};
        this.hoveredResize = null;
        this.ongoingResize = null;

        this.focused = null;

        this.isEasyAimEnabled = false;

        this.screenRect = this.screenArea.getBoundingClientRect();

        this.dock = document.querySelector("#dock");
        document.querySelector("#launcher-icon").addEventListener("mousedown", (event) => {
            this.showLauncher();

            // Prevent window manager from taking focus from the launcher
            event.stopPropagation();
        });

        window.addEventListener("mousemove", (event) => {
            const {mouseX, mouseY} = this.translateMouse(event);
            if (this.draggingWindow != null) {
                const {window, offset} = this.draggingWindow;
                window.element.style.left = mouseX - offset[0];
                window.element.style.top = mouseY - offset[1];
                //this.focusWindow(window);
                this.setFocused({window})
            } else if (this.ongoingResize != null) {
                const {window, anchor, offset} = this.ongoingResize;

                const rect = this.rectWithinScreenArea(window.element);
                const canvasWrapper = window.element.querySelector(".canvas-wrapper");
                const canvasRect = this.rectWithinScreenArea(canvasWrapper);

                let newX;
                let newY;
                let newWidth;
                let newHeight;

                if (anchor.includes("N")) {
                    const targetY = mouseY - offset[1];
                    const targetDY = targetY - rect.y;
                    newHeight = Math.max(canvasRect.height - targetDY, MIN_SIZE[1]);
                    const dy = canvasRect.height - newHeight;
                    newY = rect.y + dy;
                }
                if (anchor.includes("E")) {
                    const prevRight = rect.x + rect.width;
                    const newRight = mouseX - offset[0];
                    const dx = newRight - prevRight;
                    newWidth = Math.max(canvasRect.width + dx, MIN_SIZE[0]);
                }
                if (anchor.includes("S")) {
                    const prevBot = rect.y + rect.height;
                    const newBot = mouseY - offset[1];
                    const dy = newBot - prevBot;
                    newHeight = Math.max(canvasRect.height + dy, MIN_SIZE[1]);
                }
                if (anchor.includes("W")) {
                    const targetX = mouseX - offset[0];
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
                    
                    const titlebar = window.element.getElementsByClassName(CLASS_TITLEBAR)[0];
                    const padding = Number.parseInt(titlebar.style.paddingLeft.replace("px", ""));
                    titlebar.style.width = newWidth - padding;
                }
                if (newHeight != undefined) {
                    canvasWrapper.style.height = newHeight;
                }

            }
        });

        window.addEventListener("mousedown", (event) => {
            // Mouse clicked on the desktop environment outside any of the windows
            //this.unfocusWindow();
            this.setFocused(null);
        });

        window.addEventListener("mouseup", (event) => {
            if (this.draggingWindow != null) {
                const {window} = this.draggingWindow;
                this.setFocused({window});
                //this.focusWindow(window);
                this.draggingWindow = null;
            }

            if (this.ongoingResize != null) {
                const window = this.ongoingResize.window;
                const canvasWrapper = window.element.querySelector(".canvas-wrapper");
                const canvas = window.element.querySelector("canvas");
                canvas.style.width = canvasWrapper.style.width;
                canvas.style.height = canvasWrapper.style.height;
                const canvasRect = this.rectWithinScreenArea(canvas);
                const resizeEvent = {width: canvasRect.width * CANVAS_SCALE, height: canvasRect.height * CANVAS_SCALE};
                canvas.style.display = "none"; // Hide during resize to reduce glitching
                this.sendInputToProcess(window, {name: "windowWasResized", event: resizeEvent});
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
        for (let pid in this.windows) {
            const win = this.windows[pid];
            if (win.process.programName == PROGRAM_LAUNCHER) {
                this.setFocused({window: win});
                //this.focusWindow(win);
                return;
            }
        }
        this.spawnProgram(PROGRAM_LAUNCHER);
    }

    rectWithinScreenArea(element) {
        const rect = element.getBoundingClientRect();
        return {x: rect.x - this.screenRect.x, y: rect.y - this.screenRect.y, width: rect.width, height: rect.height};
    }

    onResizeDone(pid) {
        const canvas = this.windows[pid].element.querySelector("canvas");
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
        window.process.worker.postMessage({userInput});
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
            //this.focusWindow(window);
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
                document.querySelector(`#dock-item-${pid}`).classList.add("focused");
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

    static renderTemplate(template, args) {
        const regex = /{{([a-zA-Z]+)}}/;
        for (let i = 0; i < 100; i ++) {
            const match = template.match(regex);
            if (match == null) {
                return template;
            }

            template = template.replace(match[0], args[match[1]]);
        }
        console.error("Didn't render the entire template: ", template);
    }

    static async fetchAndRenderTemplate(url, args) {
        const response = await fetch(url);
        const template = await response.text();
        const rendered = WindowManager.renderTemplate(template, args)
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
            const available = this.screenArea.getBoundingClientRect();
            return [available.width / 2 - width / 2, available.height / 2 - height / 2];
        }
    }

    async createWindow(title, [width, height], proc, resizable, menubarItems) {
        const pid = proc.pid;
        title = `${title} (pid=${pid})`

        const doc = await WindowManager.fetchAndRenderTemplate("kernel/html/window-template.html", {pid, title, width, height});

        const winElement = doc.querySelector('.program-window');
        const win = {element: winElement, process: proc};

        const canvasWrapper = winElement.querySelector(".canvas-wrapper");
        const canvas = winElement.querySelector("canvas");
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

        const closeButton = winElement.querySelector(".titlebar-button");
        closeButton.addEventListener("mousedown", (event) => {
            // Prevent drag
            event.stopPropagation();
        });
        closeButton.addEventListener("click", (event) => {
            this.sendInputToProcess(win, {name: "closeWasClicked"});
        });

        const menubar = winElement.querySelector(".menubar");
        
        for (let itemConfig of menubarItems) {
            const {text, id} = itemConfig;

            if ("dropdown" in itemConfig) {
                const buttonDoc = await WindowManager.fetchAndRenderTemplate("kernel/html/menubar-dropdown-button-template.html", {buttonId: id, text});
                const wrapper = buttonDoc.querySelector(".dropdown-wrapper");
                const dropdown = buttonDoc.querySelector(".dropdown");
                const button = buttonDoc.querySelector(".menubar-button");
                menubar.appendChild(wrapper);
                for (const {text, id} of itemConfig.dropdown) {
                    const itemDoc = await WindowManager.fetchAndRenderTemplate("kernel/html/dropdown-item-template.html", {itemId: id, text});
                    const item = itemDoc.querySelector(".dropdown-item");
                    dropdown.appendChild(item);
                    item.addEventListener("mousedown", (event) => {
                        this.setFocused(null);
                        const itemId = item.dataset.itemId;
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
                const buttonDoc = await WindowManager.fetchAndRenderTemplate("kernel/html/menubar-button-template.html", {buttonId: id, text});
                const button = buttonDoc.querySelector(".menubar-button");
                menubar.appendChild(button);
                button.addEventListener("click", (event) => {
                    const buttonId = event.target.dataset.buttonId;
                    this.sendInputToProcess(win, {name: "menubarButtonWasClicked", event: {buttonId}});
                });
            }
        }

        const titlebar = winElement.querySelector(".titlebar");
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
        canvas.addEventListener(
            "wheel", 
            (event) => {
                event = {deltaY: event.deltaY};
                this.sendInputToProcess(win, {name: "wheel", event});
            }, 
            // "passive" fixes warning log: https://chromestatus.com/feature/5745543795965952
            {passive:true}
        );
    
        this.screenArea.appendChild(winElement);

        const rect = this.rectWithinScreenArea(winElement);
        const position = this.positionNewWindow(rect.width, rect.height);
        winElement.style.left = position[0];
        winElement.style.top = position[1];

        // Now that the window is part of the DOM, we can calculate and set dropdown positions
        for (let dropdownWrapper of winElement.querySelectorAll(".dropdown-wrapper")) {
            const windowX = winElement.getBoundingClientRect().left;
            const buttonX = dropdownWrapper.getBoundingClientRect().left;
            dropdownWrapper.querySelector(".dropdown").style.left = `${buttonX - windowX}px`;
        }

        this.windows[pid] = win;
        console.log("Added window. ", this.windows);

        const dockItem = document.createElement("div");
        dockItem.id = `dock-item-${pid}`;
        dockItem.classList.add("dock-item");
        dockItem.innerText = win.process.programName;
        dockItem.addEventListener("mousedown", (event) => {
            this.setFocused({window: this.windows[pid]});

             // Prevent window manager from taking focus from the window
             event.stopPropagation();
        });
        this.dock.appendChild(dockItem);

        this.setFocused({window: win});

        const offscreenCanvas = canvas.transferControlToOffscreen();
        return offscreenCanvas;
    }
    
    removeWindowIfExists(pid) {
        const win = this.getWindow(pid);
        if (win) {
            delete this.windows[pid];
            win.element.remove();
            console.log("Removed window. ", this.windows);

            const dockItem = document.getElementById(`dock-item-${pid}`);
            dockItem.remove();
        }

        this.focusFrontMostWindow();
    }

    translateMouse(event) {
        return {mouseX: event.x - this.screenRect.x, mouseY: event.y - this.screenRect.y};
    }
}
