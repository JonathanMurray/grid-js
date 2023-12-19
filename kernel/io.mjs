import { ANSI_CURSOR_BACK, ANSI_CURSOR_END_OF_LINE, ANSI_CURSOR_FORWARD, ASCII_BACKSPACE, ASCII_CARRIAGE_RETURN, ASCII_END_OF_TEXT, ASCII_END_OF_TRANSMISSION, FileOpenMode, FileType, TextWithCursor, ansiBackgroundColor, assert } from "../shared.mjs";
import { SysError, Errno } from "./errors.mjs";
import { WaitQueues } from "./wait-queues.mjs";



const _PseudoTerminalMode = {
    /** raw mode */
    CHARACTER: "CHARACTER",

    /** like raw mode, except that sigint is handled */
    CHARACTER_AND_SIGINT: "CHARACTER_AND_SIGINT",

    /** cooked mode */
    LINE: "LINE"
}

class _PtySlaveFile {
    constructor(pty) {
        this._pty = pty;
        this._isOpen = true;

        pty._pipeToSlave.incrementNumReaders();
        pty._pipeToMaster.incrementNumWriters();
    }

    open() {
    }

    close() {
        assert(this._isOpen, "closing already closed");
        this._isOpen = false;
        this._pty._pipeToSlave.decrementNumReaders();
        this._pty._pipeToMaster.decrementNumWriters();
    }

    writeAt(_charIdx, text) {
        assert(this._isOpen, "writing closed");
        this._pty._writeOnSlave(text);
    }
    
    readAt(_charIdx, args) {
        assert(this._isOpen, "reading closed");
        return this._pty._pipeToSlave.read(args);
    }

    seek() {
        throw new SysError("cannot seek pty-slave", Errno.SPIPE);
    }

    getStatus() {
        return {
            type: FileType.PTY
        }
    }
}

class _PtyMasterFile {
    constructor(pty) {
        this._pty = pty;
        this._isOpen = true;

        pty._pipeToMaster.incrementNumReaders();
        pty._pipeToSlave.incrementNumWriters();
    }

    open() {
    }

    close() {
        assert(this._isOpen);
        this._isOpen = false;
        this._pty._pipeToMaster.decrementNumReaders();
        this._pty._pipeToSlave.decrementNumWriters();

        this._pty._onMasterClosed();
    }

    writeAt(_charIdx, text) {
        assert(this._isOpen);
        this._pty._writeOnMaster(text);
    }
    
    readAt(_charIdx, args) {
        assert(this._isOpen);
        return this._pty._pipeToMaster.read(args);
    }

    seek() {
        throw new SysError("cannot seek pty-master", Errno.SPIPE);
    }

    getStatus() {
        return {
            type: FileType.PTY
        }
    }

    pollRead() {
        assert(this._isOpen);
        return this._pty._pipeToMaster.pollRead();
    }
}

// TODO: Handle this with a device file instead. It will be "just another case", sitting next to "textfile" and "browser console".
export class PseudoTerminal {
    // Pseudoterminal a.k.a. PTY is used for IO between the terminal and the shell.
    // https://man7.org/linux/man-pages/man7/pty.7.html
    // https://unix.stackexchange.com/questions/117981/what-are-the-responsibilities-of-each-pseudo-terminal-pty-component-software
    constructor(system, sid) {
        this._sid = sid
        this.foreground_pgid = null;

        this._mode = _PseudoTerminalMode.LINE;
        this._system = system;
        this._lineDiscipline = new _LineDiscipline(this);

        this._pipeToSlave = new _Pipe();
        this._pipeToMaster = new _Pipe();

        this.slave = new _PtySlaveFile(this);
        this.master = new _PtyMasterFile(this);

        this._terminalSize = null; // is set on resize
    }

    _onMasterClosed() {
        console.log(`[${this._sid}] Session leader controlling PTTY dies. Sending HUP (hangup) to foreground process group.`)
        this._system.sendSignalToProcessGroup("hangup", this.foreground_pgid);
        this._system.removePseudoTerminal(this._sid);
    }

    openNewSlave() {
        return new _PtySlaveFile(this);
    }

    _writeOnSlave(text) {
        this.writeToMaster(text);
    }

    _writeOnMaster(text) {
        if (this._mode == _PseudoTerminalMode.LINE) {
            this._lineDiscipline.handleTextFromMaster(text);
        } else if (this._mode == _PseudoTerminalMode.CHARACTER) {
            this.writeToSlave(text);
        } else {
            assert(this._mode == _PseudoTerminalMode.CHARACTER_AND_SIGINT);
            let buf = "";
            while (text.length > 0) {
                if (text[0] == ASCII_END_OF_TEXT) {
                    if (buf.length > 0) {
                        this.writeToSlave(buf);
                        buf = "";
                    }
                    this.ctrlC();
                } else {
                    buf += text[0];
                }
                text = text.slice(1);
            }
            if (buf.length > 0) {
                this.writeToSlave(buf);
                buf = "";
            }
        }
    }

    ctrlC() {
        const pgid = this.foreground_pgid;
        this._system.sendSignalToProcessGroup("interrupt", pgid);
    }

    control(config) {
        if ("mode" in config) {
            if (config.mode in _PseudoTerminalMode) {
                this._mode = config.mode;
                return;
            }
        } else if ("resize" in config) {
            assert("width" in config.resize && "height" in config.resize);
            this._terminalSize = [config.resize.width, config.resize.height];
            if (this.foreground_pgid != null) {
                this._system.sendSignalToProcessGroup("terminalResize", this.foreground_pgid);
            }
            return;
        } else if ("setForegroundPgid" in config) {
            const pgid = config.setForegroundPgid;
            this.foreground_pgid = pgid;
            this._pipeToSlave.setRestrictReadsToProcessGroup(pgid);
            return;
        } else if ("getForegrounPgid" in config) {
            return this.foreground_pgid;
        } else if ("getTerminalSize" in config) {
            assert(this._terminalSize, "terminal size not set");
            return this._terminalSize;
        }
        throw new SysError(`invalid pty config: ${JSON.stringify(config)}`);
    }

    writeToMaster(text) {
        this._pipeToMaster.write(text);
    }

    writeToSlave(text) {
        this._pipeToSlave.write(text);
    }
}

class _LineDiscipline {
    constructor(pty) {
        this.pty = pty;
        this.line = new TextWithCursor();
    }

    handleTextFromMaster(text) {
        while (text != "") {

            let matched;
            let echo = true;
            
            if (text[0] == ASCII_BACKSPACE) {
                
                this.backspace();
                echo = false;
                matched = 1;
            } else if (text[0] == "\n") {
                this.newline();
                matched = 1;
            } else if (text[0] == ASCII_END_OF_TEXT) {
                this.pty.ctrlC();
                echo = false;
                matched = 1;
            } else if (text[0] == ASCII_END_OF_TRANSMISSION) {
                this.ctrlD();
                echo = false;
                matched = 1;
            } else if (text[0] == ASCII_CARRIAGE_RETURN) {
                this.line.moveToStart();
                matched = 1;
            } else if (text.startsWith(ANSI_CURSOR_BACK)) {
                this.line.moveLeft();
                matched = ANSI_CURSOR_BACK.length;
            } else if (text.startsWith(ANSI_CURSOR_FORWARD)) {
                this.line.moveRight();
                matched = ANSI_CURSOR_FORWARD.length;
            } else if (text.startsWith(ANSI_CURSOR_END_OF_LINE)) {
                this.line.moveToEnd();
                matched = ANSI_CURSOR_END_OF_LINE.length;
            } else {
                this.line.insert(text[0]);
                matched = 1;
            } 
            
            if (echo) {
                this.pty.writeToMaster(text.slice(0, matched));
            }
            text = text.slice(matched);
        }
    }

    backspace() {
        // https://unix.stackexchange.com/a/414246
        const text = ASCII_BACKSPACE + " " + ASCII_BACKSPACE;
        this.line.backspace();
        this.pty.writeToMaster(text);
    }

    ctrlD() {
        const text = this.line.text;
        this.line.reset();
        // Send the line. If it's empty, this will be interpreted as EOF by the pipe, which is by design.
        this.pty.writeToSlave(text); 
    }

    newline() {
        const text = this.line.text + "\n";
        this.line.reset();
        this.pty.writeToSlave(text);
    }
}

class _Pipe {
    constructor() {
        this._buffer = [];
        this._waitingReaders = [];
        this._waitingPollers = [];
        this._restrictReadsToProcessGroup = null;
        this._numReaders = 0;
        this._numWriters = 0;
        this._waitQueues = new WaitQueues();
        this._waitQueues.addQueue("waiting");
    }

    decrementNumReaders() {
        this._numReaders --;
        assert(this._numReaders >= 0, "non-negative number of pipe readers");
    }

    decrementNumWriters() {
        this._numWriters --;
        assert(this._numWriters >= 0,  "non-negative number of pipe writers");
        this._waitQueues.wakeup("waiting");
    }
    
    incrementNumReaders() {
        this._numReaders ++;
    }

    incrementNumWriters() {
        this._numWriters ++;
    }

    setRestrictReadsToProcessGroup(pgid) {
        this._restrictReadsToProcessGroup = pgid;
        this._waitQueues.wakeup("waiting");
    }
    
    isProcAllowedToRead(proc) {
        return this._restrictReadsToProcessGroup == null || this._restrictReadsToProcessGroup == proc.pgid;
    }
    
    async pollRead() {
        await this._waitQueues.waitFor("waiting", () => this._buffer.length > 0 || this._numWriters == 0);
    }

    async read({proc, nonBlocking}) {
        assert(this._numReaders > 0);
        assert(proc != null);
        
        if (nonBlocking) {
            if (this._buffer.length > 0) {
                if (this.isProcAllowedToRead(proc)) {
                    return this._doRead();
                } else {
                    throw new SysError("not allowed to read", Errno.WOULDBLOCK);
                }
            } else {
                throw new SysError("nothing available", Errno.WOULDBLOCK);
            }
        }

        await this._waitQueues.waitFor("waiting", () => this.isProcAllowedToRead(proc) && (this._buffer.length > 0 || this._numWriters == 0));
        return this._doRead();
    }

    
    write(text) {
        assert(this._numWriters > 0, "A writer must exist");
        if (this._numReaders == 0) {
            throw new SysError("read-end is closed");
        }

        this._buffer = this._buffer.concat(text);
        this._waitQueues.wakeup("waiting");
    }

    _doRead() {
        let text = "";
        let n = 0;
        if (this._buffer.length == 0) {
            assert(this._numWriters == 0);
            // All writers have been closed.
            // All further reads on this pipe will give EOF
        } else if (this._buffer[0] == "") {
            // A writer has pushed EOF to the buffer.
            // It will result in EOF for exactly one read.
            n = 1;
        } else {
            // Offer everything up until (but excluding) EOF
            for (let i = 0; i < this._buffer.length; i++) {
                if (this._buffer[i] == "") {
                    break;
                }
                text += this._buffer[i];
                n += 1;
            }
        }

        this._buffer = this._buffer.slice(n);
        return text;
    }
}

export class NullFile {
    constructor() {
    }

    writeAt() {
        // text is discarded
    }

    readAt() {
        return ""; //EOF
    }

    open() {
        // relevant for pipes
    }

    close() {
        // relevant for pipes
    }

    setLength() {
        throw new SysError("cannot set length on null device");
    }

    getStatus() {
        return {
            type: FileType.PIPE
        };
    }
}

export class BrowserConsoleFile {

    constructor() {
        this._waitQueues = new WaitQueues();
        this._input = "";
        this._waitingReaders = [];
        this._waitQueues.addQueue("waiting");
    }

    // This call is meant to originate from the user typing into the browser's dev console
    addInputFromBrowser(text) {
        this._input += text;
        this._waitQueues.wakeup("waiting");
    }

    writeAt(_charIdx, text) {
        console.log(ansiBackgroundColor(text, 45));
    }

    async readAt(_charIndex) {
        await this._waitQueues.waitFor("waiting", () => this._input.length > 0);
        const text = this._input;
        this._input = "";
        return text;
    }

    open() {
        // relevant for pipes
    }

    close() {
        // relevant for pipes
    }

    setLength() {
        throw new SysError("cannot set length on console device");
    }

    getStatus() {
        return {
            type: FileType.PIPE
        };
    }
}

export class PipeFile {
    constructor() {
        this._pipe = new _Pipe();
    }
    
    readAt(_charIndex, args) {
        return this._pipe.read(args);
    }

    writeAt(_charIndex, text) {
        return this._pipe.write(text);
    }

    open(mode) {
        if (mode == FileOpenMode.READ) {
            this._pipe.incrementNumReaders();
        } else if (mode == FileOpenMode.WRITE) {
            this._pipe.incrementNumWriters();
        } else {
            this._pipe.incrementNumReaders();
            this._pipe.incrementNumWriters();
        }
    }

    close(mode) {
        if (mode == FileOpenMode.READ) {
            this._pipe.decrementNumReaders();
        } else if (mode == FileOpenMode.WRITE) {
            this._pipe.decrementNumWriters();
        } else {
            this._pipe.decrementNumReaders();
            this._pipe.decrementNumWriters();
        }
    }

    setLength() {
        throw new SysError("cannot set length on pipe");
    }

    getStatus() {
        return {
            type: FileType.PIPE
        };
    }

}

export class TextFile {
    constructor(text) {
        this.text = text;
    }

    writeAt(charIndex, text) {
        const existing = this.text;
        this.text = existing.slice(0, charIndex) + text + existing.slice(charIndex + text.length);
    }

    readAt(charIndex) {
        return this.text.slice(charIndex);
    }

    open() {
        // relevant for pipes
    }

    close() {
        // relevant for pipes
    }

    setLength(length) {
        this.text = this.text.slice(0, length);
    }

    getStatus() {
        return {
            type: FileType.TEXT,
            length: this.text.length
        };
    }
}

export class Directory {
    constructor() {
        this._entries = {};
    }

    createDirEntry(name, file) {
        assert(name != null && !name.includes("/"));
        this._entries[name] = file;

        if (file instanceof Directory) {
            file._entries["."] = file;
            file._entries[".."] = this;
        }
    }

    dirEntries() {
        return this._entries;
    }

    open(mode) {
        if (mode !== FileOpenMode.DIRECTORY) {
            throw new SysError(`cannot open directory as: ${mode}`);
        }
    }

    close() {
        // relevant for pipes
    }

    readAt() {
        throw new SysError("cannot read directory", Errno.ISDIR)
    }

    writeAt() {
        throw new SysError("cannot write directory", Errno.ISDIR)
    }

    getStatus() {
        return {
            type: FileType.DIRECTORY
        };
    }
}

/** "file" in Linux */
export class OpenFileDescription {
    constructor(system, id, file, mode, filePath, openerProc) {
        this._system = system;
        this._id = id;
        this._file = file;
        this._mode = mode;
        this._filePath = filePath;
        this.openerProc = openerProc;

        this._refCount = 1;
        this._charIndex = 0;

        this._file.open(mode);

        // Linux file operations: https://www.oreilly.com/library/view/linux-device-drivers/0596000081/ch03s03.html
    }

    async write(text) {
        if (this._mode == FileOpenMode.READ) {
            throw new SysError("write not allowed");
        }

        const result = await this._file.writeAt(this._charIndex, text, this);
        this._charIndex += text.length;
        return result;
    }

    async read(args) {
        // TODO also forward "nonBlocking" arg?
        if (this._mode == FileOpenMode.WRITE) {
            throw new SysError("read not allowed");
        }

        const text = await this._file.readAt(this._charIndex, args, this);
        this._charIndex += text.length;
        return text;
    }

    controlDevice(args) {
        return this._file.controlDevice(args, this);
    }

    seek(position) {
        assert(position != undefined);
        this._charIndex = position;
    }

    decrementRefCount() {
        this._refCount --;
        assert(this._refCount >= 0);

        if (this._refCount == 0) {
            this._file.close(this._mode, this);
            delete this._system.openFileDescriptions[this._id];
        }
    }

    incrementRefCount() {
        assert(this._refCount > 0); // One must exist to be duplicated
        this._refCount ++;
    }

    setLength(length) {
        this._file.setLength(length);
    }

    getStatus() {
        return this._file.getStatus();
    }

    getFilePath() {
        return this._filePath;
    }

    pollRead() {
        return this._file.pollRead(this);
    }
}

export class FileDescriptor {
    /**
     * @param {OpenFileDescription} openFileDescription 
     */
    constructor(openFileDescription) {
        this._openFileDescription = openFileDescription;
        this._isOpen = true;
    }

    write(text) {
        assert(this._isOpen, "Cannot write to closed file descriptor");
        return this._openFileDescription.write(text);
    }
    
    read(args) {
        assert(this._isOpen);
        return this._openFileDescription.read(args);
    }

    controlDevice(args) {
        assert(this._isOpen);
        return this._openFileDescription.controlDevice(args);
    }

    close() {
        if (this._isOpen) {
            this._isOpen = false;
            this._openFileDescription.decrementRefCount();
        }
    }

    duplicate() {
        assert(this._isOpen);
        this._openFileDescription.incrementRefCount();
        return new FileDescriptor(this._openFileDescription);
    }

    seek(position) {
        assert(this._isOpen);
        this._openFileDescription.seek(position);
    }

    setLength(length) {
        assert(this._isOpen);
        this._openFileDescription.setLength(length);
    }

    getStatus() {
        return this._openFileDescription.getStatus();
    }

    getFilePath() {
        return this._openFileDescription.getFilePath();
    }

    pollRead() {
        return this._openFileDescription.pollRead();
    }
}

