
const ID_WINDOW_PREFIX = "program-window-";
const CLASS_WINDOW = "program-window";
const CLASS_HEADER = "program-window-header";

class WindowManager {

    constructor() {
        this.draggingWindow = null;
        this.maxZIndex = 1;
        this.visibleWindows = {};
        this.focusedWindow = null;
    }

    getWindow(pid) {
        return document.getElementById(ID_WINDOW_PREFIX + pid);
    }

    getFrontMostWindow() {
        const windows = Array.from(document.getElementsByClassName(CLASS_WINDOW));
        return windows.reduce(function(prev, current) {
            return (prev && prev.style.zIndex > current.style.zIndex) ? prev : current
        });
    }
    
    focusFrontMostWindow() {
        const window = this.getFrontMostWindow();
        this.focusElement(window);
    }
    
    focusElement(element) {
        if (element.style.zIndex < this.maxZIndex) {
            element.style.zIndex = ++this.maxZIndex;
        }
    
        element.getElementsByTagName("iframe")[0].focus();
        element.classList.add("focused");

        this.focusedWindow = element;
    }
    
    focusWindow(pid) {
        const window = this.getWindow(pid);
        this.focusElement(window);
    }
    
    makeWindowVisible(title, size, pid) {
        const window = this.getWindow(pid);
        window.style.display = "block";
    
        const iframe = window.getElementsByTagName("iframe")[0];
        if (size != undefined) {
            iframe.width = size[0];
            iframe.height = size[1];
        }
        title = `[${pid}] ${title || "Untitled"}`
        window.getElementsByClassName(CLASS_HEADER)[0].innerHTML = title;
    
        let left;
        let top;
    
        const frontMostWindow = this.getFrontMostWindow();
        
        if (frontMostWindow.style != undefined && frontMostWindow.style.left) {
            const offset = 25;
            left = parseInt(frontMostWindow.style.left.replace("px", "")) + offset;
            top = parseInt(frontMostWindow.style.top.replace("px", "")) + offset;
        } else {
            const availableScreenSpace = document.getElementsByTagName("body")[0].getBoundingClientRect()
            left = availableScreenSpace.width / 2 - window.getBoundingClientRect().width / 2;
            top = availableScreenSpace.height / 2 - window.getBoundingClientRect().height / 2;
        }
    
        window.style.left = left;
        window.style.top = top;
    
        this.focusElement(window);

        this.visibleWindows[pid] = window;
        console.log("Added window. ", this.visibleWindows);
    }
    
    createInvisibleWindow(iframe, pid) {
        // Remove the diagonal corner that iframe gets by default
        iframe.setAttribute("frameborder", "0");

        const header = document.createElement("div");
        header.classList.add(CLASS_HEADER);
        header.style = "background:white; border-bottom: 2px solid lightgray; font-family: monospace; font-weight: bold; font-size: 18px; height: 25px;";
        
        const window = document.createElement("div");
        window.style = "display: none; position: absolute; background: white; user-select: none; border: 2px solid lightgray;";
        window.id = ID_WINDOW_PREFIX + pid;
        window.classList.add(CLASS_WINDOW);
    
        window.appendChild(header);
        window.appendChild(iframe);
    
        window.addEventListener("mousedown", (event) => {
            const left = parseInt(window.style.left.replace("px", "")) || window.getBoundingClientRect().x;
            const top = parseInt(window.style.top.replace("px", "")) || window.getBoundingClientRect().y;
            this.draggingWindow = {window, offset: [event.x - left, event.y - top]};
            this.focusElement(window);
        });
    
        iframe.addEventListener("mousedown", (event) => {
            window.classList.add("focused");
        });
    
        iframe.addEventListener("focus", (event) => {
            window.classList.add("focused");
        });
        header.addEventListener("focus", (event) => {
            window.classList.add("focused");
        });
    
        iframe.addEventListener("blur", (event) => {
            window.classList.remove("focused");
        });
    
        document.getElementsByTagName("body")[0].appendChild(window);

    }
    
    removeWindow(pid) {
        const window = this.getWindow(pid);
        delete this.visibleWindows[pid];
        window.remove();

        //console.log("Removed window. ", this.visibleWindows);
    }
    
    onMouseMove(event) {
        if (this.draggingWindow != null) {
            const {window, offset} = this.draggingWindow;
            window.style.left = event.x - offset[0];
            window.style.top = event.y - offset[1];
            this.focusElement(window);
        }
    }
    
    onMouseUp(event) {
        if (this.draggingWindow != null) {
            const {window} = this.draggingWindow;
            this.focusElement(window);
            this.draggingWindow = null;
        }
    }
}
