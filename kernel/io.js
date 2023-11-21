const PseudoTerminalMode = {
    // character / raw mode
    CHARACTER: "CHARACTER",

    // line / cooked mode
    LINE: "LINE"
}

class PseudoTerminal {
    // Pseudoterminal a.k.a. PTY is used for IO between the terminal and the shell.
    // https://man7.org/linux/man-pages/man7/pty.7.html
    // https://unix.stackexchange.com/questions/117981/what-are-the-responsibilities-of-each-pseudo-terminal-pty-component-software
    constructor(system) {
        this.foreground_pgid = null;

        this._mode = PseudoTerminalMode.LINE;
        this._system = system;
        this.lineDiscipline = new LineDiscipline(this);
        this.pipeToSlave = new Pipe();
        this.pipeToMaster = new Pipe();
        this.masterWriter = {
            requestWrite: (writer) => {
                let text = writer();
                console.log("Text from master: ", text);
                if (this._mode == PseudoTerminalMode.LINE) {
                    this.lineDiscipline.handleTextFromMaster(text);
                } else {
                    this.pipeToSlave.requestWrite(this._createInfallibleWriter(text));
                    /*
                    let buf = "";
                    while (text != "") {
                        if (text[0] == ASCII_END_OF_TEXT) {
                            if(buf != "") {
                                this.pipeToSlave.requestWrite(this._createInfallibleWriter(text));
                                buf = "";
                            }
                            this.ctrlC();
                        } else {
                            buf += text[0];
                        }
                        text = text.slice(1);
                    }
                    if(buf != "") {
                        this.pipeToSlave.requestWrite(this._createInfallibleWriter(text));
                    }
                    */
                }
            }
        }
        this.slaveWriter = {
            requestWrite: (writer) => {
                const text = writer();
                this.pipeToMaster.requestWrite(this._createInfallibleWriter(text));
            },
            close: () => {
                console.log("TODO: slaveWriter.close()");
            },
            duplicate: () => {
                console.log("TODO: slaveWriter.duplicate()");
                return this.slaveWriter;
            }
        }
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
        }
        throw new SysError(`invalid pty config: ${JSON.stringify(config)}`);
    }

    setForegroundPgid(pgid) {
        this.foreground_pgid = pgid;
        this.pipeToSlave.setRestrictReadsToProcessGroup(pgid);
    }

    _createInfallibleWriter(text) {
        function writer(error)  {
            assert(error == undefined);
            return text;
        }
        return writer;
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
                this.line.backspace();
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
                this.pty.pipeToMaster.requestWrite(this.pty._createInfallibleWriter(text.slice(0, matched)));
            }
            text = text.slice(matched);
        }
    }


    ctrlD() {
        const text = this.line.text + ASCII_END_OF_TRANSMISSION;
        this.line.reset();
        this.pty.pipeToSlave.requestWrite(this.pty._createInfallibleWriter(text));
    }

    newline() {
        const text = this.line.text + "\n";
        this.line.reset();
        this.pty.pipeToSlave.requestWrite(this.pty._createInfallibleWriter(text));
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
        assert(this.numReaders >= 0);
    }

    onWriterClose() {
        this.numWriters --;
        assert(this.numWriters >= 0);
        if (this.numWriters == 0) {
            this.buffer += ASCII_END_OF_TRANSMISSION; // This will signal end of stream to anyone reading it
        }
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

    requestRead({reader, proc}) {
        assert(this.numReaders > 0);
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
        this.buffer += text;
        this.handleWaitingReaders();
    }

    handleWaitingReaders() {

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
        assert(this.isOpen);
        return this.pipe.requestRead({reader, proc});
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

    duplicate () {
        assert(this.isOpen);
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

    duplicate () {
        assert(this.isOpen);
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
        assert(this.isOpen);
        const text = writer();
        this.openFileDescription.write(text);
    }
    
    requestRead({reader, proc}) {
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
}

class NullStream {
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
}