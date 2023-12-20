import { FileOpenMode, FileType, ansiBackgroundColor, assert } from "../shared.mjs";
import { SysError, Errno } from "./errors.mjs";
import { Pipe } from "./pipe.mjs";
import { WaitQueues } from "./wait-queues.mjs";




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
        this._pipe = new Pipe();
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
        this.id = id;
        this._file = file;
        this._mode = mode;
        this._filePath = filePath;
        this.openerProc = openerProc;

        this._refCount = 1;
        this._charIndex = 0;

        this._file.open(mode, this);

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
            delete this._system.openFileDescriptions[this.id];
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

