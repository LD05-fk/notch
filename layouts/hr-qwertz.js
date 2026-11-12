/* Croatian QWERTZ (also used for Slovenian, Bosnian, Serbian Latin). ISO. */
Notch.registerLayout({
  id: "hr-qwertz",
  name: "Hrvatski (QWERTZ)",
  iso: true,
  dead: ["Backquote"],
  base: {
    Digit1: "1", Digit2: "2", Digit3: "3", Digit4: "4", Digit5: "5", Digit6: "6", Digit7: "7", Digit8: "8", Digit9: "9", Digit0: "0", Minus: "'", Equal: "+",
    KeyQ: "q", KeyW: "w", KeyE: "e", KeyR: "r", KeyT: "t", KeyY: "z", KeyU: "u", KeyI: "i", KeyO: "o", KeyP: "p", BracketLeft: "š", BracketRight: "đ",
    KeyA: "a", KeyS: "s", KeyD: "d", KeyF: "f", KeyG: "g", KeyH: "h", KeyJ: "j", KeyK: "k", KeyL: "l", Semicolon: "č", Quote: "ć", Backslash: "ž",
    IntlBackslash: "<", KeyZ: "y", KeyX: "x", KeyC: "c", KeyV: "v", KeyB: "b", KeyN: "n", KeyM: "m", Comma: ",", Period: ".", Slash: "-",
  },
  shift: {
    Digit1: "!", Digit2: "\"", Digit3: "#", Digit4: "$", Digit5: "%", Digit6: "&", Digit7: "/", Digit8: "(", Digit9: ")", Digit0: "=", Minus: "?", Equal: "*",
    IntlBackslash: ">", Comma: ";", Period: ":", Slash: "_",
  },
  altgr: {
    Digit1: "~", KeyQ: "\\", KeyW: "|", KeyE: "€", KeyF: "[", KeyG: "]", KeyV: "@", KeyB: "{", KeyN: "}", KeyM: "§",
  },
});
