import Globals from "../build/Globals-browser.js";

import { minidenticon } from 'minidenticons'

import WebChatChannel from "./webchat-channel.riot";

riot.register("webchat-channel", WebChatChannel);

// Need to call minidenticon to activate it.
minidenticon();

import * as riot from "riot";

import App from "./app.riot"

const mountApp = riot.component(App);
const app = mountApp(document.querySelector("#app"), { Globals });


import "./main.css";
