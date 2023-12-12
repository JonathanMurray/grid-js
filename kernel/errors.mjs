export class SysError {
    constructor(message, errno) {
        this.name = "SysError";
        this.message = message;
        this.errno = errno;
    }
}

export const Errno = {
    WOULDBLOCK: "WOULDBLOCK",
    /** Trying to seek on a pipe */
    SPIPE: "SPIPE",
}