import { ANSI_CURSOR_BACK, ANSI_CURSOR_END_OF_LINE, ANSI_CURSOR_FORWARD, ASCII_BACKSPACE, ASCII_CARRIAGE_RETURN, ASCII_END_OF_TEXT, ASCII_END_OF_TRANSMISSION, FileType, TextWithCursor, ansiBackgroundColor, assert } from "../shared.mjs";
import { SysError, Errno } from "./errors.mjs";



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
    
    requestWriteAt(_charIdx, writer) {
        assert(this._isOpen, "writing closed");
        this._pty._requestWriteOnSlave(writer);
    }
    
    requestReadAt(_charIdx, args) {
        assert(this._isOpen, "reading closed");
        return this._pty._pipeToSlave.requestRead(args);
    }

    seek() {
        throw new SysError("cannot seek pty-slave", Errno.SPIPE);
    }

    getFileType() {
        return FileType.PTY;
    }

    getFileName() {
        return `[slave:${this._pty._sid}]`;
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
    }

    requestWriteAt(_charIdx, writer) {
        assert(this._isOpen);
        this._pty._requestWriteOnMaster(writer);
    }
    
    requestReadAt(_charIdx, args) {
        assert(this._isOpen);
        return this._pty._pipeToMaster.requestRead(args);
    }

    seek() {
        throw new SysError("cannot seek pty-master", Errno.SPIPE);
    }

    getFileType() {
        return FileType.PTY;
    }

    getFileName() {
        return `[master:${this._pty._sid}]`;
    }

    pollRead(resolver) {
        assert(this._isOpen);
        return this._pty._pipeToMaster.pollRead(resolver);
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

    openNewSlave() {
        return new _PtySlaveFile(this);
    }

    _requestWriteOnSlave(writer) {
        const text = writer();
        this.writeToMaster(text);
    }

    _requestWriteOnMaster(writer) {
        let text = writer();
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

    _createCarelessWriter(text) {
        function writer(error)  {
            if (error) {
                console.warn(`Failed writing to PTY: ${error}`);
            } else {
                return text;
            }
        }
        return writer;
    }

    writeToMaster(text) {
        this._pipeToMaster.requestWrite(this._createCarelessWriter(text));
    }

    writeToSlave(text) {
        this._pipeToSlave.requestWrite(this._createCarelessWriter(text));
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
    }

    decrementNumReaders() {
        this._numReaders --;
        assert(this._numReaders >= 0, "non-negative number of pipe readers");
    }

    decrementNumWriters() {
        this._numWriters --;
        assert(this._numWriters >= 0,  "non-negative number of pipe writers");
        this._handleWaiting();
    }
    
    incrementNumReaders() {
        this._numReaders ++;
    }

    incrementNumWriters() {
        this._numWriters ++;
    }

    setRestrictReadsToProcessGroup(pgid) {
        this._restrictReadsToProcessGroup = pgid;
        while (this._handleWaiting()) {}
    }
    
    isProcAllowedToRead(proc) {
        return this._restrictReadsToProcessGroup == null || this._restrictReadsToProcessGroup == proc.pgid;
    }

    requestRead({reader, proc, nonBlocking}) {
        assert(this._numReaders > 0);
        assert(proc != null);
        
        if (nonBlocking) {
            if (this._buffer.length > 0) {
                if (this.isProcAllowedToRead(proc)) {
                    this._invokeReader(reader);
                } else {
                    reader({error: {name: "SysError", message: "not allowed to read", errno: Errno.WOULDBLOCK}});
                }
            } else {
                reader({error: {name: "SysError", message: "nothing available", errno: Errno.WOULDBLOCK}});
            }
            return;
        }

        this._waitingReaders.push({reader, proc});
        this._handleWaiting();
    }

    pollRead(resolver) {
        this._waitingPollers.push(resolver);
        this._handleWaiting();
    }
    
    requestWrite(writer) {
        assert(this._numWriters > 0, "A writer must exist");
        if (this._numReaders == 0) {
            writer("read-end is closed");
            return;
        }

        const text = writer();
        this._buffer = this._buffer.concat(text);
        this._handleWaiting();
    }

    _handleWaiting() {
        if (this._buffer.length > 0 || this._numWriters == 0) {
            if (this._waitingReaders.length > 0) {
                for (let i = 0; i < this._waitingReaders.length;) {
                    const {reader, proc} = this._waitingReaders[i];
                    if (proc.exitValue != null) {
                        // The process will never be able to read
                        this._waitingReaders.splice(i, 1);
                    } else if (this.isProcAllowedToRead(proc)) {
                        this._waitingReaders.splice(i, 1);
                        if (this._invokeReader(reader)) {
                            return true; // Indicate that it may be useful to call the function again
                        }
                    } else {
                        // The reader was left in the list, and we move onto the next one
                        i++;
                    }
                }
            }

            // TODO: Handle blocking IO / polling with a generic Kernel-provided wait-queue mechanism?
            //       https://www.makelinux.net/ldd3/?u=chp-6.shtml
            while (this._waitingPollers.length > 0) {
                const poller = this._waitingPollers.shift();
                poller(); // signal to the polling process that the fd is ready for reading
            }

        }
        return false;
    }

    _invokeReader(reader) {
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

        // Check that a read actually occurs. This is necessary because of readAny()
        if (reader({text})) {
            this._buffer = this._buffer.slice(n);
            return true; 
        }
        return false;
    }
}

export class NullFile {
    constructor(fileName) {
        this._fileName = fileName;
    }
    
    getFileName() {
        return this._fileName;
    }

    requestWriteAt(_charIndex, writer) {
        writer();
        // The text is discarded
    }

    requestReadAt(_charIdx, {reader}) {
        reader({text: ""}); // EOF
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
            pipe: {}
        };
    }

    getFileType() {
        return FileType.PIPE;
    }
}

export class BrowserConsoleFile {

    constructor(fileName) {
        this._fileName = fileName;
        this._input = "";
        this._waitingReaders = [];
    }
    
    getFileName() {
        return this._fileName;
    }

    // This call is meant to originate from the user typing into the browser's dev console
    addInputFromBrowser(text) {
        this._input += text;
        this._checkReaders();
    }

    _checkReaders() {
        if (this._input && this._waitingReaders.length > 0) {
            const reader = this._waitingReaders.shift();
            if (reader({text: this._input})) {
                this._input = "";
            }
        }
    }

    requestWriteAt(_charIndex, writer) {
        const text = writer();
        console.log(ansiBackgroundColor(text, 45));
    }

    requestReadAt(_charIndex, {reader}) {
        this._waitingReaders.push(reader);
        this._checkReaders();
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
            pipe: {}
        };
    }

    getFileType() {
        return FileType.PIPE;
    }
}

export class PipeFile {
    constructor(fileName) {
        this._fileName = fileName;
        this._pipe = new _Pipe();
    }
    
    getFileName() {
        return this._fileName;
    }

    requestReadAt(_charIndex, args) {
        this._pipe.requestRead(args);
    }

    requestWriteAt(_charIndex, writer) {
        this._pipe.requestWrite(writer);
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
            pipe: {}
        };
    }

    getFileType() {
        return FileType.PIPE;
    }
}

export class TextFile {
    constructor(fileName, text) {
        this._fileName = fileName;
        this.text = text;
    }

    getFileName() {
        return this._fileName;
    }

    requestWriteAt(charIndex, writer) {
        const existing = this.text;
        const text = writer();
        this.text = existing.slice(0, charIndex) + text + existing.slice(charIndex + text.length);
    }

    requestReadAt(charIndex, {reader}) {
        const text = this.text.slice(charIndex);
        reader({text});
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
            text: {
                length: this.text.length
            }
        };
    }

    getFileType() {
        return FileType.TEXT;
    }
}

export const FileOpenMode = {
    READ: "READ",
    WRITE: "WRITE",
    READ_WRITE: "READ_WRITE",
}


/** "file" in Linux */
export class OpenFileDescription {
    constructor(system, id, file, mode) {
        this._system = system;
        this._id = id;
        this._file = file;
        this._mode = mode;
        this._refCount = 1;
        this._charIndex = 0;

        this._file.open(mode);
    }

    requestWrite(writer) {
        if (this._mode == FileOpenMode.READ) {
            writer("write not allowed");
            return;
        }

        const wrappedWriter = (error) => {
            if (error == null) {
                const text = writer();
                this._charIndex += text.length;
                return text;
            } else {
                writer(error);
            }
        }

        this._file.requestWriteAt(this._charIndex, wrappedWriter);
        
    }

    requestRead({proc, reader}) {
        // TODO also forward "nonBlocking" arg?
        if (this._mode == FileOpenMode.WRITE) {
            reader({error: "read not allowed"});
            return;
        }

        const wrappedReader = ({text, error}) => {
            if (error == null) {
                assert(text != null);
                this._charIndex += text.length; 
            }
            return reader({text, error});
        }

        this._file.requestReadAt(this._charIndex, {proc, reader: wrappedReader});
    }

    seek(position) {
        assert(position != undefined);
        this._charIndex = position;
    }

    decrementRefCount() {
        this._refCount --;
        assert(this._refCount >= 0);

        if (this._refCount == 0) {
            this._file.close(this._mode);
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

    getFileType() {
        return this._file.getFileType();
    }

    getFileName() {
        return this._file.getFileName();
    }

    pollRead(resolver) {
        return this._file.pollRead(resolver);
    }
}

export class FileDescriptor {
    constructor(openFileDescription) {
        this._openFileDescription = openFileDescription;
        this._isOpen = true;
    }

    requestWrite(writer) {
        assert(this._isOpen, "Cannot write to closed file descriptor");
        this._openFileDescription.requestWrite(writer);
    }
    
    requestRead(args) {
        assert(this._isOpen);
        this._openFileDescription.requestRead(args);
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

    getFileType() {
        return this._openFileDescription.getFileType();
    }

    getFileName() {
        return this._openFileDescription.getFileName();
    }

    pollRead(resolver) {
        return this._openFileDescription.pollRead(resolver);
    }
}

