const stdlib = function() {

    async function createWindow(title, size, options) {

        let resizable = true;
        if (options != undefined) {
            if ("resizable" in options) {
                resizable = options.resizable;
            }
        }

        const canvas = await syscall("graphics", {title, size, resizable});

        let win = {
            canvas, 
            // These are overwritten by applications that want to handle user input
            onkeydown: (event) => {},
            onclick: (event) => {},
            onmousemove: (event) => {},
            onmouseout: (event) => {},
            onresize: (event) => {},
            onwheel: (event) => {},
        }

        handleWindowInput((name, event) => { 
            if (name == "keydown") {
                win.onkeydown(event);
            } else if (name == "click") {
                win.onclick(event);
            }  else if (name == "mousemove") {
                win.onmousemove(event);
            } else if (name == "mouseout") {
                win.onmouseout(event);
            } else if (name == "wheel") {
                win.onwheel(event);
            } else if (name == "resize") {
                win.onresize(event);
                postMessage({resizeDone: null});
            } else {
                console.error("Unhandled input event: ", event);
            }
        });

        return win;
    }

    function write(text, streamId) {
        if (streamId == undefined) {
            // stdout by default
            streamId = 1;
        }
        return syscall("write", {text, streamId});
    }

    function writeln(line, streamId) {
        return write(line + "\n", streamId);
    }

    function writeError(message, streamId) {
        return write(`${ANSI_CSI}37;41mError${ANSI_CSI}39;49m <${message}>\n`, streamId)
    }

    function read(streamId) {
        if (streamId == undefined) {
            // stdin by default
            streamId = 0;
        }
        return syscall("read", {streamId});
    }

    function log(args) {
        console.log(`[${pid}]`, args);
    }

    const terminal = function() {
        async function clear() {
            await write(ANSI_ERASE_ENTIRE_SCREEN);
        }

        async function enterAlternateScreen() {
            await write(ANSI_ENABLE_ALTERNATIVE_BUFFER);
        }

        async function exitAlternateScreen() {
            await write(ANSI_DISABLE_ALTERNATIVE_BUFFER);
        }

        async function setTextStyle(style) {
            await writeCommand({setTextStyle: style});
        }

        async function setBackgroundStyle(style) {
            await writeCommand({setBackgroundStyle: style});
        }

        async function getCursorPosition() {
            await write(ANSI_GET_CURSOR_POSITION);
            const response = await read();

            const responseRegex = /\x1B\[(.+);(.+)R/;
            const responseMatch = response.match(responseRegex);
            const line = Number.parseInt(responseMatch[1]);
            const col = Number.parseInt(responseMatch[2]);
            assert(Number.isInteger(line) && Number.isInteger(col), "Invalid cursor position response: " + response);
            return [line, col];
        }

        async function writeCommand(command) {
            command = JSON.stringify(command);
            const len = command.length;
            console.assert(len < 256);
            await write(`${ansiCustomTerminalCommand(len)}${command}`);
        }

        return {clear, setTextStyle, setBackgroundStyle, writeCommand, enterAlternateScreen, exitAlternateScreen, getCursorPosition};
    } ();


    class BufferedReader {
        constructor() {
            this.buf = "";
            this.hasReachedEnd = false;
        }

        async readLine() {

            if (this.hasReachedEnd) {
                throw new SysError("can't read beyond end of stream");
            }

            while (!this.buf.includes("\n") && !this.buf.includes(ASCII_END_OF_TRANSMISSION)) {
                const read = await syscall("read", {streamId: 0});
                this.buf += read;
            }

            const newlineIndex = this.buf.indexOf("\n");
            const eotIndex = this.buf.indexOf(ASCII_END_OF_TRANSMISSION);

            if (eotIndex >= 0 && (eotIndex < newlineIndex || newlineIndex == -1)) {
                // the end of the stream has been reached
                this.hasReachedEnd = true;
                return null;
            }

            console.assert(newlineIndex >= 0, `eotindex: ${eotIndex}, newlineIndex: ${newlineIndex}`);

            const line = this.buf.slice(0, newlineIndex);
            this.buf = this.buf.slice(newlineIndex + 1);
            return line;
        }
    }
    
    const bufferedReader = new BufferedReader();
    const readln = () => bufferedReader.readLine();

    return {createWindow, terminal, write, writeln, writeError, read, readln, log};

} ();

