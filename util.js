
function assert(condition, message) {
    if (!condition) {
        console.error("Assertion failed", message);
        debugger;
    }
}