import { SysError, Errno } from "./errors.mjs";
import { WaitQueues } from "./wait-queues.mjs";
import { assert } from "../shared.mjs";

export class Pipe {
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