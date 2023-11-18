
const ID_WINDOW_PREFIX = "program-window-";
const CLASS_WINDOW = "program-window";
const CLASS_HEADER = "program-window-header";
const CLASS_FOCUSED = "focused";

class WindowManager {

    constructor() {
        this.draggingWindow = null;
        this.maxZIndex = 1;
        this.windows = {};
        this.focusedWindow = null;

        this.isEasyDragEnabled = false;

        window.addEventListener("mousemove", (event) => {
            if (this.draggingWindow != null) {
                const {window, offset} = this.draggingWindow;
                window.element.style.left = event.x - offset[0];
                window.element.style.top = event.y - offset[1];
                this.focusWindow(window);
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
                
                this.enableEasyDrag();
            }

            if (this.focusedWindow != null) {
                this.sendInputToProcess(this.focusedWindow, {name: "keydown", event: {key: event.key, ctrlKey: event.ctrlKey}});
            }
        });

        window.addEventListener("keyup", (event) => {
            console.log(event);
            if (event.key == "Control") {
                this.disableEasyDrag();
            }
        })
    }

    enableEasyDrag() {
        document.querySelector("body").classList.add("alt-cursor");
        this.isEasyDragEnabled = true;
    }

    disableEasyDrag() {
        document.querySelector("body").classList.remove("alt-cursor");
        this.isEasyDragEnabled = false;
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

    
    createWindow(title, size, proc) {
        
        const pid = proc.pid;
        const worker = proc.worker;
        
        const scale = window.devicePixelRatio; // Change to 1 on retina screens to see blurry canvas.

        const header = document.createElement("div");
        header.classList.add(CLASS_HEADER);
        header.style = "border-bottom: 2px solid lightgray; font-family: monospace; font-weight: bold; font-size: 18px; height: 25px;";
        
        const winElement = document.createElement("div");
        const win = {element: winElement, worker}
        winElement.style = "display: none; position: absolute; background: white; user-select: none; border: 2px solid lightgray;";
        winElement.id = ID_WINDOW_PREFIX + pid;
        winElement.classList.add(CLASS_WINDOW);

        const canvas = document.createElement("canvas");
        canvas.width = size[0];
        canvas.height = size[1];
        
        canvas.width = Math.floor(size[0] * scale);
        canvas.height = Math.floor(size[1] * scale);

    
        winElement.appendChild(header);
        winElement.appendChild(canvas);

        const offscreenCanvas = canvas.transferControlToOffscreen();
    
        header.addEventListener("mousedown", (event) => {
            const left = parseInt(winElement.style.left.replace("px", "")) || winElement.getBoundingClientRect().x;
            const top = parseInt(winElement.style.top.replace("px", "")) || winElement.getBoundingClientRect().y;
            this.draggingWindow = {window: win, offset: [event.x - left, event.y - top]};
            this.focusWindow(win);

            // Prevent window manager from taking focus from the window
            event.stopPropagation();
        });

        winElement.addEventListener("mousedown", (event) => {
            if (this.isEasyDragEnabled) {
                const left = parseInt(winElement.style.left.replace("px", "")) || winElement.getBoundingClientRect().x;
                const top = parseInt(winElement.style.top.replace("px", "")) || winElement.getBoundingClientRect().y;
                this.draggingWindow = {window: win, offset: [event.x - left, event.y - top]};
            }
            this.focusWindow(win);

            // Prevent window manager from taking focus from the window
            event.stopPropagation();
        });
        
        // User input to process
        canvas.addEventListener("mousemove", (event) => {
            this.sendInputToProcess(win, {name: "mousemove", event: {x: event.offsetX, y: event.offsetY}});
        });
        canvas.addEventListener("mouseout", (event) => {
            this.sendInputToProcess(win, {name: "mouseout", event: {}});
        });
        canvas.addEventListener("click", (event) => {
            this.sendInputToProcess(win, {name: "click", event: {x: event.offsetX, y: event.offsetY}});
        });
    
        //TODO
        header.addEventListener("focus", (event) => {
            winElement.classList.add(CLASS_FOCUSED);
        });


    
        document.getElementsByTagName("body")[0].appendChild(winElement);

        winElement.style.display = "block";
        title = `[${pid}] ${title || "Untitled"}`
        winElement.getElementsByClassName(CLASS_HEADER)[0].innerHTML = title;
    
        let left;
        let top;
    
        const frontMostWindow = this.getFrontMostWindow();
        
        if (frontMostWindow && frontMostWindow.element.style && frontMostWindow.element.style.left) {
            const offset = 25;
            left = parseInt(frontMostWindow.element.style.left.replace("px", "")) + offset;
            top = parseInt(frontMostWindow.element.style.top.replace("px", "")) + offset;
        } else {
            const availableScreenSpace = document.getElementsByTagName("body")[0].getBoundingClientRect()
            left = availableScreenSpace.width / 2 - winElement.getBoundingClientRect().width / 2;
            top = availableScreenSpace.height / 2 - winElement.getBoundingClientRect().height / 2;
        }
    
        winElement.style.left = left;
        winElement.style.top = top;
    
        this.focusWindow(win);

        this.windows[pid] = win;
        console.log("Added window. ", this.windows);

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
