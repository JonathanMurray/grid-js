const stdlib = function() {

    async function createWindow(title, size) {
        const canvas = await syscall("graphics", {title, size});

        let win = {
            canvas, 
            // These are overwritten by applications that want to handle user input
            onkeydown: (event) => {},
            onclick: (event) => {},
            onmousemove: (event) => {},
            onmouseout: (event) => {},
        }

        setInputListener((name, event) => {
            if (name == "keydown") {
                win.onkeydown(event);
            } else if (name == "click") {
                win.onclick(event);
            }  else if (name == "mousemove") {
                win.onmousemove(event);
            } else if (name == "mouseout") {
                win.onmouseout(event);
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

    function log(args) {
        console.log(`[${pid}]`, args);
    }

    const terminal = function() {
        async function clear() {
            await writeCommand({clear: null});
        }

        async function printPrompt() {
            await writeCommand({printPrompt: null});
        }

        async function setTextStyle(style) {
            await writeCommand({setTextStyle: style});
        }

        async function setBackgroundStyle(style) {
            await writeCommand({setBackgroundStyle: style});
        }

        async function writeCommand(command) {
            command = JSON.stringify(command);
            const len = command.length;
            console.assert(len < 256);
            await write(`\x1B${String.fromCharCode(len)}${command}`);
        }

        return {clear, printPrompt, setTextStyle, setBackgroundStyle, writeCommand};
    } ();

    const EOT = "\x04";

    class BufferedReader {
        constructor() {
            this.buf = "";
            this.hasReachedEnd = false;
        }

        async readLine() {

            if (this.hasReachedEnd) {
                throw new SysError("can't read beyond end of stream");
            }

            while (!this.buf.includes("\n") && !this.buf.includes(EOT)) {
                const read = await syscall("read", {streamId: 0});
                this.buf += read;
            }

            const newlineIndex = this.buf.indexOf("\n");
            const eotIndex = this.buf.indexOf(EOT);

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
    
    const readerSingleton = new BufferedReader();
    const readln = () => readerSingleton.readLine();

    return {createWindow, terminal, write, writeln, readln, log};

} ();
