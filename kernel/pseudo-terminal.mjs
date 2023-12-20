import { SysError, Errno } from "./errors.mjs";
import { Pipe } from "./pipe.mjs";
import { assert, FileType, ASCII_END_OF_TEXT, TextWithCursor, ASCII_BACKSPACE, ASCII_END_OF_TRANSMISSION, ASCII_CARRIAGE_RETURN, ANSI_CURSOR_BACK, ANSI_CURSOR_FORWARD, ANSI_CURSOR_END_OF_LINE, FileOpenMode } from "../shared.mjs";
import { System } from "./system.mjs";

const _PseudoTerminalMode = {
    /** raw mode */
    CHARACTER: "CHARACTER",

    /** like raw mode, except that sigint is handled */
    CHARACTER_AND_SIGINT: "CHARACTER_AND_SIGINT",

    /** cooked mode */
    LINE: "LINE"
}


let _pseudoTerminals = [];
let _nextSlaveNumber = 1;

class _PtmxDevice {

    /**
     * @param {System} system 
     */
    constructor(system) {
        this._system = system;
    }

    open(_mode, openFileDescription) {
        const openFileId = openFileDescription.id;
        const slaveNumber = _nextSlaveNumber ++;
        const pty = new _PseudoTerminal(this._system, openFileId, slaveNumber);
        pty._onMasterOpened();
        _pseudoTerminals.push(pty);
    }

    _getPty(openFileDescription) {
        const pty = _pseudoTerminals.find(pty => pty.masterOpenFileId === openFileDescription.id);
        assert(pty != null);
        return pty;
    }

    close(_mode, openFileDescription) {
        console.log("Before remove: ", _pseudoTerminals);
        const pty = _pseudoTerminals.find(pty => pty.masterOpenFileId === openFileDescription.id);
        pty._onMasterClosed();
        _pseudoTerminals = _pseudoTerminals.filter(pty => pty.masterOpenFileId !== openFileDescription.id);
        console.log("After remove: ", _pseudoTerminals);
    }
    
    writeAt(_charIdx, text, openFileDescription) {
        const pty = this._getPty(openFileDescription);
        return pty._writeOnMaster(text)
    }

    readAt(_charIdx, args, openFileDescription) {
        const pty = this._getPty(openFileDescription);
        //console.log("[pty] PTMX READ ", openFileDescription.openerProc);
        return pty._pipeToMaster.read(args);
    }

    pollRead(openFileDescription) {
        const pty = this._getPty(openFileDescription);
        return pty._pipeToMaster.pollRead();
    }

    async controlDevice(request, openFileDescription) {
        const pty = this._getPty(openFileDescription);

        if ("getSlaveNumber" in request) {
            return pty.slaveNumber;
        } else {
            return pty.control(request);
        }
    }

    getStatus() {
        return {
            type: FileType.PTY
        }
    }
}


class _PtsDirectory {

    createDirEntry(name, file) {
        throw new SysError("not allowed to create pseudo terminal slave");
    }

    dirEntries() {
        let entries = {};
        for (const pty of _pseudoTerminals) {
            entries[pty.slaveNumber] = pty._ptsEntry;
        }
        return entries;
    }

    open(mode) {
        if (mode !== FileOpenMode.DIRECTORY) {
            throw new SysError(`cannot open directory as: ${mode}`);
        }
    }

    close() {
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

export function initPty(system, devDir) {
    const ptsDir = new _PtsDirectory();
    // https://man7.org/linux/man-pages/man7/pty.7.html
    devDir.createDirEntry("pts", ptsDir);
    const ptmx = new _PtmxDevice(system);
    devDir.createDirEntry("ptmx", ptmx);
    // https://man7.org/linux/man-pages/man4/tty.4.html
    devDir.createDirEntry("tty", new _TtyDevice());

    // For debugging
    window["pty"] = _pseudoTerminals;
}

class _TtyDevice {

    constructor() {
    }

    _getControllingTerminalPty(openFileDescription) {
        const sid = openFileDescription.openerProc.sid;
        const pty = _pseudoTerminals.find(pty => pty.slaveControllingSid == sid);
        assert(pty != null);
        return pty;
    }

    open(_mode, openFileDescription) {
        const pty = this._getControllingTerminalPty(openFileDescription);
        pty._onSlaveOpened();
    }

    close(_mode, openFileDescription) {
        const pty = this._getControllingTerminalPty(openFileDescription);
        pty._onSlaveClosed();
    }

    writeAt(_charIdx, text, openFileDescription) {
        const pty = this._getControllingTerminalPty(openFileDescription);
        pty._writeOnSlave(text);
    }
    
    async readAt(_charIdx, args, openFileDescription) {
        const pty = this._getControllingTerminalPty(openFileDescription);
        return pty._pipeToSlave.read(args);
    }

    seek() {
        throw new SysError("cannot seek pty-slave", Errno.SPIPE);
    }

    getStatus() {
        return {
            type: FileType.PTY
        }
    }

    async controlDevice(request, openFileDescription) {
        const pty = this._getControllingTerminalPty(openFileDescription);
        return pty.control(request);
    }
}


class _PtsDirEntry {
    /**
     * @param {_PseudoTerminal} pty 
     */
    constructor(pty) {
        this._pty = pty;
    }

    open(_mode, openFileDescription) {

        const sid = openFileDescription.openerProc.sid;
        if (this._pty.slaveControllingSid == null) {
            const alreadyControllingTerminal = _pseudoTerminals.find(pty => pty.slaveControllingSid == sid);
            if (alreadyControllingTerminal != null) {
                console.log(`[pty] Process already has controlling pty (slaveNumber=${alreadyControllingTerminal.slaveNumber}), so it won't claim slaveNumber=${this._pty.slaveNumber}`);
            } else {
                console.log(`[pty] Process claims PTY slave. sid=${sid}, slaveNumber=${this._pty.slaveNumber}`);
                this._pty.slaveControllingSid = sid;
            }
        }
        this._pty._onSlaveOpened();
    }

    close() {
        this._pty._onSlaveClosed();
    }

    writeAt(_charIdx, text) {
        this._pty._writeOnSlave(text);
    }
    
    async readAt(_charIdx, args, openFileDescription) {
        //console.log("[pty] SLAVE READ: ", openFileDescription.openerProc);
        const text = await this._pty._pipeToSlave.read(args);
        //console.log("[pty] READ: ", text);
        return text;
    }

    seek() {
        throw new SysError("cannot seek pty-slave", Errno.SPIPE);
    }

    getStatus() {
        return {
            type: FileType.PTY
        }
    }

    async controlDevice(request, openFileDescription) {
        return this._pty.control(request);
    }
}

class _PseudoTerminal {
    // Pseudoterminal a.k.a. PTY is used for IO between the terminal and the shell.
    // https://man7.org/linux/man-pages/man7/pty.7.html
    // https://unix.stackexchange.com/questions/117981/what-are-the-responsibilities-of-each-pseudo-terminal-pty-component-software
    constructor(system, masterOpenFileId, slaveNumber) {
        this._system = system;
        this.masterOpenFileId = masterOpenFileId;
        this.slaveNumber = slaveNumber
        this.slaveControllingSid = null; // Is determined by who opens the slave side

        console.log(`[pty] New PTY: masterOpenFileId=${masterOpenFileId}, slaveNumber=${slaveNumber}`);

        this.foreground_pgid = null;

        this._mode = _PseudoTerminalMode.LINE;
        this._lineDiscipline = new _LineDiscipline(this);

        this._ptsEntry = new _PtsDirEntry(this);

        this._pipeToSlave = new Pipe();
        this._pipeToMaster = new Pipe();

        this._terminalSize = null; // is set on resize
    }

    _onMasterOpened() {
        this._pipeToMaster.incrementNumReaders();
        this._pipeToSlave.incrementNumWriters();
    }

    _onMasterClosed() {
        console.log(`[pty] Session leader controlling PTTY dies. Sending HUP (hangup) to foreground process group.`)
        this._system.sendSignalToProcessGroup("hangup", this.foreground_pgid);

        this._pipeToMaster.decrementNumReaders();
        this._pipeToSlave.decrementNumWriters();
    }

    _onSlaveOpened() {
        this._pipeToSlave.incrementNumReaders();
        this._pipeToMaster.incrementNumWriters();
    }

    _onSlaveClosed() {
        this._pipeToSlave.decrementNumReaders();
        this._pipeToMaster.decrementNumWriters();
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
            let pgid = config.setForegroundPgid;
            assert(Number.isFinite(pgid));
            this.foreground_pgid = pgid;
            console.log("[pty] setForegroundPgid: ", pgid);
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
