"use strict";

async function main(args) {

    /*
    await syscalls.graphics({title: "Test program", size: [200, 100]});

    const element = document.createElement("p");
    element.style.position = "relative";
    element.style.textAlign = "center";
    element.style.top = "30%";
    element.style.fontWeight = "bold";
    element.style.userSelect = "none";

    element.innerHTML = "Click me!"
    document.getElementsByTagName("body")[0].appendChild(element);
    
    window.addEventListener("click", function(event) {
        syscalls.write(["I was clicked!"]);
    });

    */

    /*
    while (true) {
        let input = await syscalls.read();
        await syscalls.write(["You wrote: " + input]);
    }
    */

    const pid1 = await syscalls.spawn({program: "countdown", args: ["4"]});

    const pid2 = await syscalls.spawn({program: "countdown", args: ["6"]});

    await syscalls.write(["WAITING FOR COUNTDOWN1 TO FINISH"]);
    await syscalls.waitForExit(pid1);
    await syscalls.write(["COUNTDOWN1 FINISHED"]);

    await syscalls.write(["WAITING FOR COUNTDOWN2 TO FINISH"]);
    await syscalls.waitForExit(pid2);
    await syscalls.write(["COUNTDOWN2 FINISHED"]);

    const line = await syscalls.read();

    await syscalls.write(["YOU WROTE: " + line]);

    //return new Promise((r) => {});
}
