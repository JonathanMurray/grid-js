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

    while (true) {
        let input = await syscalls.read();
        await syscalls.write(["You wrote: " + input]);
    }

    //return new Promise((r) => {});
}
