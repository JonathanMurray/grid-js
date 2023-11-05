"use strict";

class System {

    constructor() {

        this.terminal = null; // Should be assigned after construction
        this.activeEventHandler;

        this.runningProgram = null;

        this.syscalls = new Syscalls(this);
        window.syscalls = this.syscalls;

        this.files = {
            "textfile": ["first line", "", "third line"],
            "empty": ["<script>", "function main() {}"],
            "log": ["<script>", "async function main(args) { console.log(args); }"],
            "print": ["<script>", "async function main(args) { await syscalls.write(args); }"],
        };

        const programs = [
            "countdown", "cat", "test", "snake", "animation", "editor", "sudoku", "plot"
        ];

        for (let program of programs) {
            this.initProgramFile(program);    
        }
    }

    async initProgramFile(programName) {
        const response = await fetch("programs/" + programName + ".js", {});
        let code = await response.text();
        code = "<script>\n" + code;
        this.files[programName] = code.split("\n");
    }

    call(syscall, arg) {
        console.assert(syscall in this.syscalls, "Syscall does not exist: " + syscall);
        return this.syscalls[syscall](arg);
    }

    initTerminal(terminal) {
        console.assert(this.terminal == null);
        this.terminal = terminal;
        this.activeEventHandler = this.terminal;

        const now = new Date();
        this.printOutput([
            "~ Welcome! ~",
            "------------",
            `Current time: ${now.getHours()}:${now.getMinutes()}`, 
            "Type help to get started."
        ]);
        this.terminal.printPrompt();
    }

    handleEvent(name, event) {
        if (name == "keydown") {
            // TODO: when an app is running in a focused, visible iframe, we don't get keydown events here,
            // so this code is a bit misleading.
            if (this.runningProgram != null && event.ctrlKey && event.key == "c") {
                this.runningProgram.kill();
                this.runningProgram = null;
            } else {
                this.activeEventHandler.handleEvent(name, event);
            }
        } else {
            this.activeEventHandler.handleEvent(name, event);
        }
    }

    handleInput(words) {

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
        } else if (command == "time") {
            const now = new Date();
            this.printOutput([`Current time: ${now.getHours()}:${now.getMinutes()}`]);
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
        } else if (command == "ls") {
            const fileNames = Object.keys(this.files);
            if (fileNames.length > 0) {
                this.printOutput(fileNames);
            } else {
                this.printOutput(["<no files>"]);
            }
            this.terminal.printPrompt();
            return;
        } else if (command == "run") {
            if (words.length >= 2) {
                const fileName = words[1];
                if (fileName in this.files) {
                    const lines = this.files[fileName];
                    if (lines[0] == "<script>") {
                        this.runningProgram = new SandboxedProgram(lines.slice(1).join("\n"), words.slice(2), this.syscalls);
                        this.activeEventHandler = this.runningProgram;
                        return;
                    } else {
                        this.printOutput(["<file is not runnable>"]);        
                        this.terminal.printPrompt();
                        return;                
                    }
                } else {
                    this.printOutput(["<no such file>"]);
                    this.terminal.printPrompt();
                    return;
                }
            } else {
                this.printOutput(["<missing filename argument>"]);
                this.terminal.printPrompt();
                return;
            } 
        }

        if (command in this.files) {
            const lines = this.files[command];
            if (lines[0] == "<script>") {
                this.runningProgram = new SandboxedProgram(lines.slice(1).join("\n"), words.slice(1), this.syscalls);
                this.activeEventHandler = this.runningProgram;
                return;
            } else {
                this.printOutput(["<file is not runnable>"]);        
                this.terminal.printPrompt();
                return;                
            }
        }

        this.printOutput(["Unknown command. Try typing: help"]);
        this.terminal.printPrompt();
    }

    printOutput(output) {
        this.terminal.printOutput(output);
    }

    onProgramDone() {
        this.terminal.setFocused(true);
        this.terminal.canvas.classList.add("focused");
        this.terminal.canvas.focus();

        this.activeEventHandler = this.terminal;
        this.terminal.printPrompt();
        const programContainer = document.getElementById("program-window");
        programContainer.style.display = "none";
    }

    setFocused(widget, focused) {
       
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

class SandboxedProgram {

    constructor(code, args, syscalls) {
        this.iframe = document.getElementById("program-iframe");
        this.iframe.contentWindow.postMessage({runProgram: {code, args}}, "*");
        this.syscalls = syscalls;
    }

    kill() {
        this.iframe.contentWindow.postMessage({killProgram: {}}, "*");
        this.syscalls.exit();
    }

    handleEvent(name, event) {
        //Sandboxed apps handle their own events in their iframe
    }
}

class Syscalls {
    constructor(system) {
        this.system = system;
    }

    exit() {
        this.system.onProgramDone();
    }

    write(output) {
        this.system.printOutput(output);
    }

    saveToFile({lines, fileName}) {
        console.assert(fileName, "Must provide filename when saving to file");
        this.system.saveLinesToFile(lines, fileName);
    }

    readFromFile(fileName) {
        return this.system.readLinesFromFile(fileName);
    }

    graphics({title, size}) {
        const programWindow = document.getElementById("program-window");
        programWindow.style.display = "block";
        

        const iframe = document.getElementById("program-iframe");
        iframe.focus();
        if (size != undefined) {
            iframe.width = size[0];
            iframe.height = size[1];
        }
        title = title || "Untitled program"
        document.getElementById("program-window-header").innerHTML = title;

        const availableScreenSpace = document.getElementsByTagName("body")[0].getBoundingClientRect()
        programWindow.style.left = availableScreenSpace.width / 2 - programWindow.getBoundingClientRect().width / 2;
        programWindow.style.top = availableScreenSpace.height / 2 - programWindow.getBoundingClientRect().height / 2;

        console.debug("showed iframe", iframe);
    }
}
