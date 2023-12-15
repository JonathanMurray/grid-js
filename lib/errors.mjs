import { ANSI_CSI } from "../shared.mjs";
import { writeln } from "./stdlib.mjs";
import { syscall } from "./sys.mjs";


export async function* reportCrash(pid, programName, error) {

    yield `${ANSI_CSI}37;41m[${pid}] '${programName}' crashed!${ANSI_CSI}39;49m`;

    if (error.stack) {
        const stackLines = error.stack.split('\n');

        let hasStartedWritingStackLines = false;

        let deepestStackPosition = null;

        const regex = /\((.+):(.+):(.+)\)/;
        for (let stackLine of stackLines) {
            //console.log("STACK LINE: ", stackLine);
            const match = stackLine.match(regex);
            if (match) {
                const fileName = match[1];
                //console.log(`FILENAME: '${fileName}'`)
                if (fileName.startsWith("eval at") && fileName.endsWith("<anonymous>")) {
                    // + 1: Runnable file starts with a header that is stripped off before we execute it.
                    // - 2: We run the program in a wrapping async function which presumably adds 2 lines to the start.
                    const lineCorrection = -1; 

                    const lineNumber = parseInt(match[2]) + lineCorrection;
                    const colNumber = parseInt(match[3]);
                    
                    if (deepestStackPosition == null) {
                        deepestStackPosition = [lineNumber, colNumber];
                    }
                    const translatedStackLine = stackLine.replace(regex, `(${programName}:${lineNumber}:${colNumber})`);
                    //console.log(`TRANSLATED LINE: '${translatedStackLine}'`);
                    yield translatedStackLine;
                    hasStartedWritingStackLines = true;
                }
            } else if (!hasStartedWritingStackLines) {
                yield stackLine;
            }
        }

        if (deepestStackPosition != null) {
            let [lineNumber, colNumber] = deepestStackPosition;

            const fd = await syscall("openFile", {fileName: programName});
            const code = await syscall("read", {fd});

            let line = code.split("\n")[lineNumber - 1];

            if (line !== undefined) {
                // Remove uninteresting whitespace on the left
                let trimmedLine = line.trim();
                colNumber -= (line.length - trimmedLine.length);
                line = trimmedLine;

                const width = 35;
                let i = 0; 
                for (; i < line.length - width; i++) {
                    if (i + width/4 >= colNumber) {
                        // the point of interest is now at a good place, horizontally
                        break;
                    }
                }
                colNumber -= i;

                if (line.length - i > width) {
                    line = line.slice(i, i + width) + " ...";
                } else {
                    line = line.slice(i, i + width);
                }

                if (i > 0) {
                    line = "... " + line;
                    colNumber += 4;
                }

                const lineNumString = lineNumber.toString();
                
                yield `\n${lineNumString} | ${line}`;
                yield " ".padEnd(lineNumString.length + 3 + colNumber) + 
                                `${ANSI_CSI}31m^${ANSI_CSI}39m`;
            }
        }
    }
}