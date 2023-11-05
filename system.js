"use strict";


class System {

    constructor() {

        this.terminal = null; // Should be assigned after construction
        
        this.syscalls = new Syscalls(this);
        window.syscalls = this.syscalls;

        this.nextPid = 1;
        this.processes = {};
        this.foregroundProcess = null;
        
        this.maxZIndex = 1;

        this.files = {
            "textfile": ["first line", "", "third line"],
            "empty": ["<script>", "function main() {}"],
            "log": ["<script>", "async function main(args) { console.log(args); }"],
            "print": ["<script>", "async function main(args) { await syscalls.write(args); }"],
        };

        const programs = [
            "countdown", "cat", "test", "snake", "animation", "editor", "sudoku", "plot", "ls", "time", "launcher"
        ];

        for (let program of programs) {
            this.initProgramFile(program);    
        }

        this.draggingWindow = null;

        this.stdIn = new Input();
    }

    async initProgramFile(programName) {
        const response = await fetch("programs/" + programName + ".js", {});
        let code = await response.text();
        code = "<script>\n" + code;
        this.files[programName] = code.split("\n");
    }

    async call(syscall, arg, pid) {
        console.assert(syscall in this.syscalls, "Syscall does not exist: " + syscall);
        return await this.syscalls[syscall](arg, pid);
    }

    initTerminal(terminal) {
        console.assert(this.terminal == null);
        this.terminal = terminal;

        const now = new Date();
        this.printOutput([
            "~ Welcome! ~",
            "------------",
            `Current time: ${now.getHours()}:${now.getMinutes()}`, 
            "Type help to get started."
        ]);
        this.terminal.printPrompt();
    }

    moveToFront(element) {
        if (element.style.zIndex < this.maxZIndex) {
            this.maxZIndex ++;
            element.style.zIndex = this.maxZIndex;
        }
    }

    focusProgramWindow(programWindow) {
        this.moveToFront(programWindow);
        programWindow.getElementsByTagName("iframe")[0].focus();
    }

    handleEvent(name, event) {
        if (name == "keydown") {
            if (this.foregroundProcess != null) {
                if (event.ctrlKey && event.key == "c") {
                    this.onProcessExit(this.foregroundProcess.pid);
                } else {
                    // The terminal accepts the input, but when it's submitted to the system it will be handed over to the 
                    // foreground process
                    this.terminal.handleEvent(name, event);
                }
            } else {
                this.terminal.handleEvent(name, event);
            }
        } else if (name == "mousemove") {
            if (this.draggingWindow != null) {
                const {element, iframe, offset} = this.draggingWindow;
                element.style.left = event.x - offset[0];
                element.style.top = event.y - offset[1];
                this.focusProgramWindow(element);
            }
        } else if (name == "mouseup") {
            if (this.draggingWindow != null) {
                const {element, iframe, offset} = this.draggingWindow;
                this.focusProgramWindow(element);
                this.draggingWindow = null;
            }
        } else if (name == "message") {
            // Sandboxed programs send us syscalls from iframe
            console.assert("syscall" in event.data);
            const pid = event.data.syscall.pid;
            const asyncSyscallResult = this.call(event.data.syscall.syscall, event.data.syscall.arg, pid);

            asyncSyscallResult.then((result) => {
                console.log("syscall result", event.data.syscall.syscall, event.data.syscall.arg, pid, result);
                const programWindow = document.getElementById("program-window-" + pid);
                if (programWindow) {
                    const iframe = programWindow.getElementsByTagName("iframe")[0];
                    iframe.contentWindow.postMessage({syscallResult: {success: result}}, "*");
                    console.log("Sent syscall result to program iframe");
                } else {
                    console.log("Cannot send syscall to process. It has no window. It must have shut down itself already.");
                }
            }).catch((error) => {
                console.log("syscall error", event.data.syscall.syscall, event.data.syscall.arg, pid, error);
                const programWindow = document.getElementById("program-window-" + pid);
                if (programWindow) {
                    const iframe = programWindow.getElementsByTagName("iframe")[0];
                    iframe.contentWindow.postMessage({syscallResult: {error}}, "*");
                    console.log("Sent syscall error to program iframe");
                } else {
                    console.log("Cannot send syscall error to process. It has no window. It must have shut down itself already.");
                }
            });
            
        } else {
            console.warn("Unhandled system event", name, event);
        }
    }

    handleInput(input) {

        if (this.foregroundProcess != null) {
            this.stdIn.pushInputLine(input);
            console.log("Pushed input to stdin");
            return;
        }

        const words = input.split(' ').filter(w => w !== '');

        if (words.length == 0) {
            this.terminal.printPrompt();
            return;
        } 

        const command = words[0];
        if (command == "help") {
            this.printOutput([
                "Example commands:", 
                "-------------------",
                "editor:     text editor", 
                "sudoku:     mouse-based game", 
                "time:       show current time",
                "fg <color>: change terminal text color",
                "bg <color>: change terminal background color"
            ]);
            this.terminal.printPrompt();
            return;
        } else if (command == "fg") {
            if (words.length >= 2) {
                this.terminal.setTextStyle(words[1]);
            } else {
                this.printOutput(["<missing color argument>"]);
            }
            this.terminal.printPrompt();
            return;
        } else if (command == "bg") {
            if (words.length >= 2) {
                this.terminal.setBackgroundStyle(words[1]);
            } else {
                this.printOutput(["<missing color argument>"]);
            }
            this.terminal.printPrompt();
            return;
        } else if (command == "ps") {
            const pids = Object.keys(this.processes);
            if (pids.length > 0) {
                this.printOutput(["parent  pid     program"])
                for (let pid of pids) {
                    const proc = this.processes[pid];
                    this.printOutput([proc.parentPid + "       " + pid + "       " + proc.args[0]])
                }
            } else {
                this.printOutput(["<no running processes>"]);
            }
            this.terminal.printPrompt();
            return;
        } else if (command == "kill") {
            if (words.length >= 2) {
                const pid = words[1];
                try {
                    this.kill(pid);
                } catch (e) {
                    this.printOutput(["<" + e.message + ">"]);
                }
            } else {
                this.printOutput(["<missing pid argument>"]);
            }
            this.terminal.printPrompt();
            return;
        }

        if (command in this.files) {
            try {

                const runInBackground = words.slice(-1)[0] == "&";
                let args;
                if (runInBackground) {
                    args = words.slice(0, -1);
                    console.log("Starting program in background");
                } else {
                    args = words;
                }

                const shellPid = 0;
                const pid = this.spawn(command, args, this.stdIn, shellPid);

                if (!runInBackground) {
                    this.foregroundProcess = this.processes[pid];
                }

            } catch (e) {
                this.printOutput(["<" + e.message + ">"]);
                this.terminal.printPrompt();
            }
            return;
        }

        this.printOutput(["Unknown command. Try typing: help"]);
        this.terminal.printPrompt();
    }

    kill(pid) {
        if (pid in this.processes) {
            this.onProcessExit(pid);
        } else {
            throw new Error("no such process");
        }
    }

    printOutput(output) {
        this.terminal.printOutput(output);
    }

    async readInput(pid) {
        const proc = this.processes[pid];
        console.assert(proc != undefined, "Cannot read input in non-existent process " + pid + ". Current pids: " + Object.keys(this.processes));
        if (proc.inputStream != undefined) {
            return await proc.inputStream.readLine();
        }
        throw Error("process has no stdin");
    }

    spawn(programName, args, stdIn, parentPid) {
        if (programName in this.files) {
            const lines = this.files[programName];
            if (lines[0] == "<script>") {
                const code = lines.slice(1).join("\n");
                const pid = this.nextPid;
                this.nextPid ++;

                const proc = new Process(code, args, this, pid, stdIn, parentPid);
                this.processes[pid] = proc;
                proc.start(); // We make sure that the pid is in the process table before the program starts running

                return pid;
            }
            throw Error("file is not runnable");
        }
        throw Error("no such program file");
    }

    onProcessExit(pid) {
        console.assert(pid != undefined);
        console.log("Removing process", pid);
        let proc = this.processes[pid];
        delete this.processes[pid];
        proc.onExit();
        if (this.foregroundProcess == proc) {
            this.foregroundProcess = null;
            console.log("The removed process was in foreground.");

            this.terminal.setFocused(true);
            this.terminal.canvas.classList.add("focused");
            this.terminal.canvas.focus();

            this.terminal.printPrompt();
        }
    }

    saveLinesToFile(lines, fileName) {
        this.files[fileName] = lines;
    }

    readLinesFromFile(fileName) {
        if (fileName in this.files) {
            return this.files[fileName];
        }
        return null; 
    }
}

class Process {

    constructor(code, args, system, pid, inputStream, parentPid) {
        this.code = code;
        this.pid = pid;
        this.args = args;
        this.inputStream = inputStream;
        this.exitWaiters = [];
        this.system = system;
        this.parentPid = parentPid;
    }

    start() {

        const iframe = document.createElement("iframe");
        this.iframe = iframe;
        iframe.sandbox = "allow-scripts";

        iframe.onload = () => {
            iframe.contentWindow.postMessage({startProcess: {code: this.code, args: this.args.slice(1), pid: this.pid}}, "*");
        }

        iframe.src = "sandboxed-program.html";

        const header = document.createElement("div");
        header.classList.add("program-window-header");
        header.style = "background:lightgray; font-family: system-ui; font-weight: bold;";
        header.innerHTML = "Program sandbox";
        
        const programWindow = document.createElement("div");
        this.programWindow = programWindow;
        programWindow.hidden = true;
        programWindow.style = "position: absolute; border: 2px solid lightgray; background: white; user-select: none;";
        programWindow.id = "program-window-" + this.pid;

        programWindow.appendChild(header);
        programWindow.appendChild(iframe);

        programWindow.addEventListener("mousedown", (event) => {
            const left = parseInt(programWindow.style.left.replace("px", "")) || programWindow.getBoundingClientRect().x;
            const top = parseInt(programWindow.style.top.replace("px", "")) || programWindow.getBoundingClientRect().y;
            this.system.draggingWindow = {element: programWindow, offset: [event.x - left, event.y - top], iframe};
            this.system.focusProgramWindow(programWindow);
        });

        document.getElementsByTagName("body")[0].appendChild(programWindow);

        this.system.moveToFront(programWindow);
    }

    onExit() {
        this.programWindow.remove();
        for (let waiter of this.exitWaiters) {
            waiter();
        }
    }

    waitForExit() {
        let waiter;
        const exitPromise = new Promise((resolve) => waiter = resolve);
        this.exitWaiters.push(waiter);
        return exitPromise;
    }

}

class Syscalls {
    constructor(system) {
        this.system = system;
    }

    async exit(arg, pid) {
        console.assert(pid != undefined);
        this.system.onProcessExit(pid);
    }

    async kill(pidToKill, pid) {
        if (pidToKill == pid) {
            throw new Error("process cannot kill itself");
        }
        this.system.kill(pidToKill);
    }

    async write(output, pid) {
        this.system.printOutput(output);
    }

    async read(arg, pid) {
        return this.system.readInput(pid);
    }

    async listFiles(arg, pid) {
        return Object.keys(this.system.files);
    }

    async saveToFile({lines, fileName}, pid) {
        console.assert(fileName, "Must provide filename when saving to file");
        this.system.saveLinesToFile(lines, fileName);
    }

    async readFromFile(fileName, pid) {
        return this.system.readLinesFromFile(fileName);
    }

    async spawn(programName, pid) {
        const inputStream = this.system.processes[pid].inputStream; // Inherit input stream from parent
        return this.system.spawn(programName, [programName], inputStream, pid);
    }

    async waitForExit(pidToWaitFor, pid) {
        const proc = this.system.processes[pidToWaitFor];
        if (proc) {
            console.log(pid + " Waiting for process " + pidToWaitFor + " to exit...");
            return proc.waitForExit();
        }
        console.log("Process doesn't exist / has already exited");
    }

    async graphics({title, size}, pid) {
        const programWindow = document.getElementById("program-window-" + pid);
        programWindow.style.display = "block";

        const iframe = programWindow.getElementsByTagName("iframe")[0];
        if (size != undefined) {
            iframe.width = size[0];
            iframe.height = size[1];
        }
        title = `[${pid}] ${title || "Untitled"}`
        programWindow.getElementsByClassName("program-window-header")[0].innerHTML = title;

        this.system.focusProgramWindow(programWindow);

        const availableScreenSpace = document.getElementsByTagName("body")[0].getBoundingClientRect()
        programWindow.style.left = availableScreenSpace.width / 2 - programWindow.getBoundingClientRect().width / 2;
        programWindow.style.top = availableScreenSpace.height / 2 - programWindow.getBoundingClientRect().height / 2;

        console.debug("showed iframe", iframe);
    }
}


class Input {
    constructor() {
        this.bufferedInput = [];
        this.inputWaiters = [];
    }
    
    async readLine() {
        const line = this.bufferedInput.shift();
        if (line != undefined) {
            console.log("Got input immediately:", line);
            return line;
        }

        console.log("Registering waiter for input");

        // No input exists yet. We must wait for it.
        let resolvePromise;
        const asyncInputResult = new Promise((r) => resolvePromise = r);
        this.inputWaiters.push((line) => resolvePromise(line));
        return asyncInputResult;
    }

    pushInputLine(line) {
        const waiter = this.inputWaiters.shift();
        if (waiter != undefined) {
            console.log("Giving input to water", line);
            waiter(line);
            return;
        }

        console.log("No waiter. Buffering input.", line);

        // Noone is currently waiting for input. We must buffer it.
        this.bufferedInput.push(line);
    }
}