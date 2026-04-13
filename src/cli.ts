#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./ui/App.js";

process.stdout.write("\x1b[?1049h\x1b[H");

const { waitUntilExit } = render(React.createElement(App), {
  exitOnCtrlC: false,
});

waitUntilExit().then(() => {
  process.stdout.write("\x1b[?1049l");
  process.exit(0);
});
