const PseudoTerminalMode = {
    /** raw mode */
    CHARACTER: "CHARACTER",

    /** like raw mode, except that sigint is handled */
    CHARACTER_AND_SIGINT: "CHARACTER_AND_SIGINT",

    /** cooked mode */
    LINE: "LINE"
}


class PtySlave {
    constructor(pty) {
        this.type = FileType.PTY;
        this._pty = pty;
        this._isOpen = true;
    }
    
    requestWrite(writer) {
        assert(this._isOpen, "writing closed");
        this._pty._requestWriteOnSlave(writer);
    }
    
    requestRead(reader) {
        assert(this._isOpen, "reading closed");
        return this._pty._pipeToSlave.requestRead(reader);
    }
    
    close() {
        assert(this._isOpen, "closing already closed");
        this._isOpen = false;
        this._pty._pipeToSlave.onReaderClose();
    }

    duplicate() {
        assert(this._isOpen, "duplicating closed");
        this._pty._pipeToSlave.onReaderDuplicate();
        return new PtySlave(this._pty, this.type);
    }

    seek() {
        throw new SysError("cannot seek pty-slave", Errno.SPIPE);
    }
}

class PtyMaster {
    constructor(pty, type) {
        this.type = FileType.PTY;
        this._pty = pty;
        this._isOpen = true;
    }
    
    requestWrite(writer) {
        assert(this._isOpen);
        this._pty._requestWriteOnMaster(writer);
    }
    
    requestRead(reader) {
        assert(this._isOpen);
        return this._pty._pipeToMaster.requestRead(reader);
    }
    
    close() {
        assert(this._isOpen);
        this._isOpen = false;
        this._pty._pipeToMaster.onReaderClose();
    }

    duplicate() {
        assert(this._isOpen);
        this._pty._pipeToMaster.onReaderDuplicate();
        return new PtyMaster(this._pty, this.type);
    }

    seek() {
        throw new SysError("cannot seek pty-master", Errno.SPIPE);
    }
}

class PseudoTerminal {
    // Pseudoterminal a.k.a. PTY is used for IO between the terminal and the shell.
    // https://man7.org/linux/man-pages/man7/pty.7.html
    // https://unix.stackexchange.com/questions/117981/what-are-the-responsibilities-of-each-pseudo-terminal-pty-component-software
    constructor(system, sid) {
        this._sid = sid
        this.foreground_pgid = null;

        this._mode = PseudoTerminalMode.LINE;
        this._system = system;
        this._lineDiscipline = new LineDiscipline(this);

        this._pipeToSlave = new Pipe();
        this._pipeToMaster = new Pipe();

        this.slave = new PtySlave(this, "pty");
        this.master = new PtyMaster(this, "pty");

        this._terminalSize = null; // is set on resize
    }

    openNewSlave() {
        this._pipeToSlave.onReaderDuplicate();
        return new PtySlave(this, `pty-slave(${this._sid})`);
    }

    _requestWriteOnSlave(writer) {
        const text = writer();
        this.writeToMaster(text);
    }

    _requestWriteOnMaster(writer) {
        let text = writer();
        if (this._mode == PseudoTerminalMode.LINE) {
            this._lineDiscipline.handleTextFromMaster(text);
        } else if (this._mode == PseudoTerminalMode.CHARACTER) {
            this.writeToSlave(text);
        } else {
            assert(this._mode == PseudoTerminalMode.CHARACTER_AND_SIGINT);
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

    terminalSize() {
        assert(this._terminalSize, "terminal size not set");
        return this._terminalSize;
    }

    ctrlC() {
        const pgid = this.foreground_pgid;
        this._system.sendSignalToProcessGroup("interrupt", pgid);
    }

    configure(config) {
        if ("mode" in config) {
            if (config.mode in PseudoTerminalMode) {
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
        }
        throw new SysError(`invalid pty config: ${JSON.stringify(config)}`);
    }

    setForegroundPgid(pgid) {
        this.foreground_pgid = pgid;
        this._pipeToSlave.setRestrictReadsToProcessGroup(pgid);
    }

    _createCarelessWriter(text) {
        function writer(error)  {
            console.assert(error == undefined, "Failed writing to PTY");
            return text;
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

class LineDiscipline {
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

class Pipe {
    constructor() {
        this.buffer = [];
        this.waitingReaders = [];
        this.restrictReadsToProcessGroup = null;
        this.numReaders = 1;
        this.numWriters = 1;
    }

    onReaderClose() {
        this.numReaders --;
        assert(this.numReaders >= 0);
    }

    onWriterClose() {
        this.numWriters --;
        assert(this.numWriters >= 0);
        this.handleWaitingReaders();
    }
    
    onReaderDuplicate() {
        assert(this.numReaders > 0); // one must already exist, for duplication 
        this.numReaders ++;
    }

    onWriterDuplicate() {
        assert(this.numWriters > 0); // one must already exist, for duplication 
        this.numWriters ++;
    }

    setRestrictReadsToProcessGroup(pgid) {
        this.restrictReadsToProcessGroup = pgid;
        while (this.handleWaitingReaders()) {}
    }
    
    isProcAllowedToRead(proc) {
        return this.restrictReadsToProcessGroup == null || this.restrictReadsToProcessGroup == proc.pgid;
    }

    requestRead({reader, proc, nonBlocking}) {
        assert(this.numReaders > 0);
        
        if (nonBlocking) {
            if (this.buffer.length > 0) {
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

        this.waitingReaders.push({reader, proc});
        this.handleWaitingReaders();
    }
    
    requestWrite(writer) {
        assert(this.numWriters > 0);
        if (this.numReaders == 0) {
            writer("read-end is closed");
            return;
        }

        const text = writer();
        this.buffer = this.buffer.concat(text);
        this.handleWaitingReaders();
    }

    handleWaitingReaders() {
        if (this.buffer.length > 0 || this.numWriters == 0) {
            if (this.waitingReaders.length > 0) {
                for (let i = 0; i < this.waitingReaders.length;) {
                    const {reader, proc} = this.waitingReaders[i];
                    if (proc.exitValue != null) {
                        // The process will never be able to read
                        this.waitingReaders.splice(i, 1);
                    } else if (this.isProcAllowedToRead(proc)) {
                        this.waitingReaders.splice(i, 1);
                        if (this._invokeReader(reader)) {
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

    _invokeReader(reader) {
        let text = "";
        let n = 0;
        if (this.buffer.length == 0) {
            assert(this.numWriters == 0);
            // All writers have been closed.
            // All further reads on this pipe will give EOF
        } else if (this.buffer[0] == "") {
            // A writer has pushed EOF to the buffer.
            // It will result in EOF for exactly one read.
            n = 1;
        } else {
            // Offer everything up until (but excluding) EOF
            for (let i = 0; i < this.buffer.length; i++) {
                if (this.buffer[i] == "") {
                    break;
                }
                text += this.buffer[i];
                n += 1;
            }
        }

        // Check that a read actually occurs. This is necessary because of readAny()
        if (reader({text})) {
            this.buffer = this.buffer.slice(n);
            return true; 
        }
        return false;
    }
}

class PipeReader {
    constructor(pipe) {
        this.pipe = pipe;
        this.isOpen = true;
        this.type = FileType.PIPE;
    }

    requestRead(args) {
        assert(this.isOpen);
        return this.pipe.requestRead(args);
    }

    requestWrite() {
        throw new SysError("stream is not writable");
    }
    
    close() {
        if (this.isOpen) {
            this.isOpen = false;
            this.pipe.onReaderClose();
        }
    }

    duplicate() {
        assert(this.isOpen);
        this.pipe.onReaderDuplicate();
        return new PipeReader(this.pipe);
    }

    seek() {
        throw new SysError("cannot seek pipe-reader", Errno.SPIPE);
    }
}

class PipeWriter {
    constructor(pipe) {
        this.pipe = pipe;
        this.isOpen = true;
        this.type = FileType.PIPE;
    }

    requestWrite(writer) {
        assert(this.isOpen);
        return this.pipe.requestWrite(writer);
    }

    requestRead() {
        throw new SysError("stream is not readable");
    }

    close() {
        if (this.isOpen) {
            this.isOpen = false;
            this.pipe.onWriterClose();
        }
    }

    duplicate() {
        assert(this.isOpen);
        this.pipe.onWriterDuplicate();
        return new PipeWriter(this.pipe);
    }

    seek() {
        throw new SysError("cannot seek pipe-writer", Errno.SPIPE);
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

    seek(position) {
        this.charIndex = position;
    }

    onStreamClose() {
        this.numStreams --;
        assert(this.numStreams >= 0);

        if (this.numStreams == 0) {
            delete this.system.openFileDescriptions[this.id];
        }
    }

    onStreamDuplicate() {
        assert(this.numStreams > 0); // One must exist to be duplicated
        this.numStreams ++;
    }
}

class FileStream {
    constructor(openFileDescription) {
        this.openFileDescription = openFileDescription;
        this.isOpen = true;
        this.type = FileType.TEXTFILE;
    }

    requestWrite(writer) {
        assert(this.isOpen, "Cannot write to closed file stream");
        const text = writer();
        this.openFileDescription.write(text);
    }
    
    requestRead({reader}) {
        assert(this.isOpen);
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
        assert(this.isOpen);
        this.openFileDescription.onStreamDuplicate();
        return new FileStream(this.openFileDescription);
    }

    seek(position) {
        this.openFileDescription.seek(position);
    }
}

class NullStream {
    constructor() {
        this.type = FileType.PIPE;
    }

    requestWrite(writer) {
        writer(); // Whatever was written is discarded
    }
    
    requestRead() {
        // Will never read anything
    }

    close() {}

    duplicate() {
        return this;
    }

    seek() {
        throw new SysError("cannot seek null-stream", Errno.SPIPE);
    }
}

class LogOutputStream {
    constructor(label) {
        this._label = label;
        this.type = FileType.PIPE;
    }

    requestWrite(writer) {
        const text = writer();
        console.log(this._label, text);
    }
    
    close() {}

    duplicate() {
        return this;
    }

    seek() {
        throw new SysError("cannot seek log-stream", Errno.SPIPE);
    }
}