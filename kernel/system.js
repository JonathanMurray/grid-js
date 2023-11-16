"use strict";

const EOT = "\x04";

class TextFile {
    constructor(text) {
        this.text = text;
    }
}

class OpenFileDescription {
    constructor(system, id, file) {
        this.system = system;
        this.id = id;
        this.file = file;
        this.numStreams = 1;
        this.charIndex = 0;
    }

    write(text) {
        const existing = this.file.text;
        this.file.text = existing.slice(0, this.charIndex) + text + existing.slice(this.charIndex + text.length);
        this.charIndex += text.length;
    }

    read() {
        const text = this.file.text.slice(this.charIndex);
        this.charIndex = this.file.text.length;
        return text;
    }

    onStreamClose() {
        this.numStreams --;
        console.assert(this.numStreams >= 0);

        if (this.numStreams == 0) {
            delete this.system.openFileDescriptions[this.id];
        }
    }

    onStreamDuplicate() {
        console.assert(this.numStreams > 0); // One must exist to be duplicated
        this.numStreams ++;
    }
}


class System {

    constructor() {
        this.syscalls = new Syscalls(this);

        this.nextPid = 1;
        this.processes = {};

        this.pseudoTerminals = {};
     

        this.windowManager = new WindowManager();

        // https://man7.org/linux/man-pages/man2/open.2.html#NOTES
        this.nextOpenFileDescriptionId = 1;
        this.openFileDescriptions = {};

        this.files = {};
    }

    static async init() {

        const system = new System();

        /*
        system.printOutput([
            "~ Welcome! ~",
            "------------",
            `Current time: ${now.getHours()}:${now.getMinutes()}`, 
            "Type help to get started."
        ]);
        */

        const programs = [
            "animation", 
            "cat",
            "countdown",
            "crash", 
            "diagnose",
            "echo",
            "editor", 
            "launcher", 
            "lines",
            "ls", 
            "plot", 
            "ps", 
            "shell", 
            "snake", 
            "sudoku", 
            "terminal", 
            "test", 
            "top",
            "time", 
        ];
        let files = {
            "textfile": new TextFile("hello world"),
            "empty": new TextFile("<script>\nfunction main() {}\n"),
            "log": new TextFile("<script>\nasync function main(args) { console.log(args); }\n"),
        };
        for (let program of programs) {
            const text = await System.fetchProgram(program);    
            files[program] = new TextFile(text);
        }
        system.files = files;

        const pid = system.spawnProcess({programName: "terminal", args: [], streams: {}, ppid: null, pgid: "START_NEW", sid: null});

        return system;
    }

    static async fetchProgram(programName) {
        const response = await fetch("programs/" + programName + ".js", {});
        let code = await response.text();
        code = "<script>\n" + code;
        return code;
    }

    async call(syscall, args, pid) {
        if (!(syscall in this.syscalls)) {
            throw new SysError(`no such syscall: '${syscall}'`);
        }

        const proc = this.processes[pid];
        console.assert(proc != undefined);
        
        return await this.syscalls[syscall](proc, args);
    }

    handleEvent(name, event) {
        if (name == "keydown") {
            console.log("system.keydown");
        } else if (name == "mousemove") {
            this.windowManager.onMouseMove(event);
        } else if (name == "mouseup") {
            this.windowManager.onMouseUp(event);
        } else if (name == "message") {
            if ("syscall" in event.data) {
                // Sandboxed programs send us syscalls from iframe
                this.handleSyscallMessage(event);
            } else {
                console.assert("iframeReceivedFocus" in event.data);
                const pid = event.data.iframeReceivedFocus.pid;
                this.windowManager.focusWindow(pid);
            }
        } else {
            console.warn("Unhandled system event", name, event);
        }
    }

    handleSyscallMessage(event) {
        const {syscall, arg, pid, sequenceNum} = event.data.syscall;

        //console.log(`[${pid}] ${syscall}(${JSON.stringify(arg)}) ...`);

        this.call(syscall, arg, pid).then((result) => {
            console.log(`[${pid}] ${syscall}(${JSON.stringify(arg)}) --> ${JSON.stringify(result)}`);
            const iframe = this.windowManager.getProcessIframe(pid);
            if (iframe) {
                iframe.contentWindow.postMessage({syscallResult: {success: result, sequenceNum}}, "*");
                console.debug("Sent syscall result to program iframe");
            } else {
                console.debug("Cannot send syscall to process. It has no window. It must have shut down itself already.");
            }
        }).catch((error) => {
            if (error instanceof SysError || error.name == "ProcessInterrupted" || error.name == "SysError") {
                console.warn(`[${pid}] ${syscall}(${JSON.stringify(arg)}) --> `, error);
            } else {
                console.error(`[${pid}] ${syscall}(${JSON.stringify(arg)}) --> `, error);
            }
            const iframe = this.windowManager.getProcessIframe(pid);
            if (iframe) {
                iframe.contentWindow.postMessage({syscallResult: {error, sequenceNum}}, "*");
                console.debug("Sent syscall error to program iframe");
            } else {
                console.debug("Cannot send syscall error to process. It has no window. It must have shut down itself already.");
            }
        });
    }

    waitForOtherProcessToExit(pid, pidToWaitFor) {
        const proc = this.process(pid);
        const procToWaitFor = this.process(pidToWaitFor);
        console.debug(pid + " Waiting for process " + pidToWaitFor + " to exit...");
        const self = this;
        return proc.waitForOtherToExit(procToWaitFor).then((exitValue) => {
            //console.log(`${pid} successfully waited for ${pidToWaitFor} to exit. Exit value: ${JSON.stringify(exitValue)}`, exitValue);
            delete self.processes[pidToWaitFor];
            //console.log("After deletion; processes: ", self.processes);

            if (exitValue instanceof Error) {
                throw exitValue;
            }

            return exitValue;
        });
    }

    spawnProcess({programName, args, streams, ppid, pgid, sid}) {
        console.assert(args != undefined);
        if (programName in this.files) {
            const lines = this.files[programName].text.split("\n");
            if (lines[0] == "<script>") {
                const code = lines.slice(1).join("\n");
                const pid = this.nextPid ++;
                if (pgid == "START_NEW") {
                    pgid = pid;  // The new process becomes leader of a new process group
                }
                if (sid == null) {
                    sid = pid;  // The new process becomes leader of a new session
                }

                const proc = new Process(code, programName, args, pid, streams, ppid, pgid, sid);
                this.processes[pid] = proc;

                console.log(`[${pid}] NEW PROCESS. parent=${ppid}, group=${pgid}, session=${sid}`)

                const iframe = document.createElement("iframe");
                iframe.sandbox = "allow-scripts";
                iframe.onload = () => {
                    iframe.contentWindow.postMessage({startProcess: {programName, code, args, pid}}, "*");
                }
                iframe.src = "sandboxed-process.html";
        
                this.windowManager.createInvisibleWindow(iframe, pid);

                return pid;
            }
            throw new SysError("file is not runnable: " + programName);
        }
        throw new SysError("no such program file: " + programName);
    }

    makeWindowVisible(title, size, pid) {
        this.windowManager.makeWindowVisible(title, size, pid);
    }

    onProcessExit(proc, exitValue) {
        const pid = proc.pid;
        console.assert(pid != undefined);
        console.log(`[${pid}] PROCESS EXIT`)
        if (proc.exitValue == null) {
            proc.onExit(exitValue);
            this.windowManager.removeWindow(pid);
            
            if (proc.pid == proc.sid && proc.sid in this.pseudoTerminals) {
                console.log(`[${proc.pid}] Session leader controlling PTTY dies. Sending HUP to foreground process group.`)
                const pty = this.pseudoTerminals[proc.sid];
                this.sendSignalToProcessGroup("hangup", pty.foreground_pgid);
                delete this.pseudoTerminals[proc.sid];
            }
    
            //console.log("Pseudo terminal sids: ", Object.keys(this.pseudoTerminals));
    
            this.windowManager.focusFrontMostWindow();
        }
    }

    listProcesses() {
        let procs = [];
        for (let pid of Object.keys(this.processes)) {
            const proc = this.process(pid);
            procs.push({pid, sid: proc.sid, ppid: proc.ppid, programName: proc.programName, pgid: proc.pgid, exitValue: proc.exitValue});
        }
        return procs;
    }

    createPseudoTerminal(sid) {
        const pty = new PseudoTerminal();
        this.pseudoTerminals[sid] = pty;
        return pty;
    }

    procOpenFile(proc, fileName, createIfNecessary) {
        let file = this.files[fileName];
        if (file == undefined) {
            if (createIfNecessary) {
                file = new TextFile("");
                this.files[fileName] = file;
            } else {
                throw new SysError("no such file");
            }
        }

        const id = this.nextOpenFileDescriptionId ++;
        const openFileDescription = new OpenFileDescription(this, id, file);
        this.openFileDescriptions[id] = openFileDescription;
        const fileStream = new FileStream(openFileDescription);

        const streamId = proc.addStream(fileStream);
        return streamId;
    }

    procSetFileLength(proc, streamId, length) {
        const file = proc.streams[streamId].openFileDescription.file;
        file.text = file.text.slice(0, length);
    }

    sendSignalToProcessGroup(signal, pgid) {
        let foundSome = false;
        // Note: likely quite bad performance below
        for (let pid of Object.keys(this.processes)) {
            const proc = this.processes[pid];
            if (proc.pgid == pgid) {
                this.sendSignalToProcess(signal, proc);
                foundSome = true;
            }
        }
        if (!foundSome) {
            console.log("no such process group");
        }
    }

    sendSignalToProcess(signal, proc) {
        console.log(`[${proc.pid}] Received signal: ${signal}`);
        let lethal;
        if (signal == "kill") {
            lethal = true;
        } else if (signal == "interrupt") {
            lethal = proc.receiveInterruptSignal();
        } else if (signal == "hangup") {
            lethal = true;
        } else {
            throw new SysError("no such signal");
        }

        if (lethal) {
            this.onProcessExit(proc, {killedBy: signal});
        }
    }

    process(pid) {
        if (!(pid in this.processes)) {
            throw new SysError("no such process: " + pid);
        }
        return this.processes[pid];
    }
}

const InterruptSignalBehaviour = {
    EXIT: "EXIT",
    IGNORE: "IGNORE",
    HANDLE: "HANDLE"
};


class PseudoTerminal {
    // Pseudoterminal a.k.a. PTY is used for IO between the terminal and the shell.
    // https://man7.org/linux/man-pages/man7/pty.7.html
    // https://unix.stackexchange.com/questions/117981/what-are-the-responsibilities-of-each-pseudo-terminal-pty-component-software
    constructor() {
        this.foreground_pgid = null;
        this.masterToSlave = new Pipe();
        this.slaveToMaster = new Pipe();
    }

    setForegroundPgid(pgid) {
        this.foreground_pgid = pgid;
        this.masterToSlave.setRestrictReadsToProcessGroup(pgid);
    }
}

class Pipe {
    constructor() {
        this.buffer = "";
        this.waitingReaders = [];
        this.restrictReadsToProcessGroup = null;
        this.numReaders = 1;
        this.numWriters = 1;
    }

    onReaderClose() {
        this.numReaders --;
        console.assert(this.numReaders >= 0);
    }

    onWriterClose() {
        this.numWriters --;
        console.assert(this.numWriters >= 0);
        if (this.numWriters == 0) {
            this.buffer += EOT; // This will signal end of stream to anyone reading it
        }
    }
    
    onReaderDuplicate() {
        console.assert(this.numReaders > 0); // one must already exist, for duplication 
        this.numReaders ++;
    }

    onWriterDuplicate() {
        console.assert(this.numWriters > 0); // one must already exist, for duplication 
        this.numWriters ++;
    }

    setRestrictReadsToProcessGroup(pgid) {
        this.restrictReadsToProcessGroup = pgid;
        while (this.handleWaitingReaders()) {}
    }
    
    isProcAllowedToRead(proc) {
        return this.restrictReadsToProcessGroup == null || this.restrictReadsToProcessGroup == proc.pgid;
    }

    requestRead({reader, proc}) {
        console.assert(this.numReaders > 0);
        this.waitingReaders.push({reader, proc});
        this.handleWaitingReaders();
    }
    
    requestWrite(writer) {
        console.assert(this.numWriters > 0);
        if (this.numReaders == 0) {
            writer("read-end is closed");
            return;
        }

        const text = writer();
        this.buffer += text;
        this.handleWaitingReaders();
    }

    handleWaitingReaders() {

        /*
        if (!this.isOpenForRead) {
            for (let {reader, proc} of this.waitingReaders) {
                reader({error: "read-end is closed"});
            }
        }
        */

        if (this.buffer.length > 0) {
            if (this.waitingReaders.length > 0) {
                for (let i = 0; i < this.waitingReaders.length;) {
                    const {reader, proc} = this.waitingReaders[i];
                    if (proc.exitValue != null) {
                        // The process will never be able to read
                        this.waitingReaders.splice(i, 1);
                    } else if (this.isProcAllowedToRead(proc)) {
                        this.waitingReaders.splice(i, 1);
                        // Check that a read actually occurs. This is necessary because of readAny()
                        if (reader({text: this.buffer})) {
                            this.buffer = "";
                            return true; 
                        }
                    } else {
                        // The reader was left in the list, and we move onto the next one
                        i++;
                    }
                }
            }
        }
        return false;
    }
}

class PipeReader {
    constructor(pipe) {
        this.pipe = pipe;
        this.isOpen = true;
    }

    requestRead({reader, proc}) {
        console.assert(this.isOpen);
        return this.pipe.requestRead({reader, proc});
    }
    
    close() {
        if (this.isOpen) {
            this.isOpen = false;
            this.pipe.onReaderClose();
        }
    }

    duplicate () {
        console.assert(this.isOpen);
        this.pipe.onReaderDuplicate();
        return new PipeReader(this.pipe);
    }
}

class PipeWriter {
    constructor(pipe) {
        this.pipe = pipe;
        this.isOpen = true;
    }

    requestWrite(writer) {
        console.assert(this.isOpen);
        return this.pipe.requestWrite(writer);
    }

    close() {
        if (this.isOpen) {
            this.isOpen = false;
            this.pipe.onWriterClose();
        }
    }

    duplicate () {
        console.assert(this.isOpen);
        this.pipe.onWriterDuplicate();
        return new PipeWriter(this.pipe);
    }
}

class FileStream {
    constructor(openFileDescription) {
        this.openFileDescription = openFileDescription;
        this.isOpen = true;
    }

    requestWrite(writer) {
        console.assert(this.isOpen);
        const text = writer();
        this.openFileDescription.write(text);
    }
    
    requestRead({reader, proc}) {
        console.assert(this.isOpen);
        const text = this.openFileDescription.read();
        reader({text});
    }

    close() {
        if (this.isOpen) {
            this.isOpen = false;
            this.openFileDescription.onStreamClose();
        }
    }

    duplicate() {
        console.assert(this.isOpen);
        this.openFileDescription.onStreamDuplicate();
        return new FileStream(this.openFileDescription);
    }
}

class NullStream {
    requestWrite(writer) {
        writer(); // Whatever was written is discarded
    }
    
    requestRead({reader, proc}) {
        // Will never read anything
    }

    close() {}

    duplicate() {
        return this;
    }
}

class SysError extends Error {
    constructor(message) {
        super(message);
        this.name = "SysError";
    }
}
