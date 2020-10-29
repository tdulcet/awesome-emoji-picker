"use strict";

import * as AddonSettings from "/common/modules/AddonSettings/AddonSettings.js";
import * as BrowserCommunication from "/common/modules/BrowserCommunication/BrowserCommunication.js";

import { COMMUNICATION_MESSAGE_TYPE } from "/common/modules/data/BrowserCommunicationTypes.js";
import * as symbols from "/common/modules/data/Symbols.js";
import * as emojimart from "/common/lib/emoji-mart-embed/dist/emoji-mart.js";

const settings = {
    autocorrectEmojis:  null,
    autocorrectEmojiShortcodes:  null,
    autocomplete:  null,
};

let autocorrections = {};

// Longest autocorrection
let longest = 0;

let symbolpatterns = [];
// Do not autocorrect for these patterns
let antipatterns = [];

const emojiShortcodes = {};

/**
 * Apply new autocorrect settings and create regular expressions.
 *
 * @returns {void}
 */
function applySettings() {
    autocorrections = {};

    // Add all symbols to our autocorrections map, we want to replace
    if (settings.autocorrectEmojis) {
        Object.assign(autocorrections, symbols.emojis);
    }
    if (settings.autocorrectEmojiShortcodes) {
        Object.assign(autocorrections, emojiShortcodes);
    }

    // Longest autocorrection
    longest = 0;

    for (const symbol in autocorrections) {
        if (symbol.length > longest) {
            longest = symbol.length;
        }
    }
    console.log("Longest autocorrection", longest);

    symbolpatterns = [];
    // Escape special characters
    const re = /[.*+?^${}()|[\]\\]/g;

    for (const symbol in autocorrections) {
        symbolpatterns.push(symbol.replace(re, "\\$&"));
    }

    // Do not autocorrect for these patterns
    antipatterns = [];
    for (const x in autocorrections) {
        let length = 0;
        let index = x.length;

        for (const y in autocorrections) {
            if (x === y) {
                continue;
            }
            const aindex = x.indexOf(y);
            if (aindex >= 0) {
                if (aindex < index) {
                    index = aindex;
                    length = y.length;
                } else if (aindex === index && y.length > length) {
                    length = y.length;
                }
            }
        }

        if (length > 0) {
            length = x.length - (index + length);
            if (length > 1) {
                antipatterns.push(x.slice(0, -(length - 1)));
            }
        }
    }
    antipatterns = antipatterns.filter((item, pos) => antipatterns.indexOf(item) === pos);
    console.log("Do not autocorrect for these patterns", antipatterns);

    antipatterns.forEach((symbol, index) => {
        antipatterns[index] = symbol.replace(re, "\\$&");
    });

    symbolpatterns = new RegExp(`(${symbolpatterns.join("|")})$`);
    antipatterns = new RegExp(`(${antipatterns.join("|")})$`);
}

/**
 * On error.
 *
 * @param {string} error
 * @returns {void}
 */
function onError(error) {
    console.error(`Error: ${error}`);
}

/**
 * Set autocorrect settings.
 *
 * @param {Object} autocorrect
 * @returns {void}
 */
function setSettings(autocorrect) {
    settings.autocorrectEmojis = autocorrect.autocorrectEmojis;
    settings.autocorrectEmojiShortcodes = autocorrect.autocorrectEmojiShortcodes;
    settings.autocomplete = autocorrect.autocompleteEmojiShortcodes;

    applySettings();
}

/**
 * Send autocorrect settings to content scripts.
 *
 * @param {Object} autocorrect
 * @returns {void}
 */
function sendSettings(autocorrect) {
    setSettings(autocorrect);

    browser.tabs.query({}).then((tabs) => {
        for (const tab of tabs) {
            browser.tabs.sendMessage(
                tab.id,
                {
                    "type": COMMUNICATION_MESSAGE_TYPE.AUTOCORRECT_CONTENT,
                    "autocomplete": settings.autocomplete,
                    "autocorrections": autocorrections,
                    "longest": longest,
                    "symbolpatterns": symbolpatterns,
                    "antipatterns": antipatterns,
                    "emojiShortcodes": emojiShortcodes
                }
            ).catch(onError);
        }
    }).catch(onError);
}

/**
 * Init autocorrect module.
 *
 * @public
 * @returns {void}
 */
export async function init() {
    const autocorrect = await AddonSettings.get("autocorrect");

    for (const key in emojiMart.emojiIndex.emojis) {
        const emoji = emojiMart.emojiIndex.emojis[key];
        emojiShortcodes[emoji.colons] = emoji.native;
    }

    Object.freeze(emojiShortcodes);

    setSettings(autocorrect);

    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        // console.log(message);
        if (message.type === COMMUNICATION_MESSAGE_TYPE.AUTOCORRECT_CONTENT) {
            const response = {
                "type": COMMUNICATION_MESSAGE_TYPE.AUTOCORRECT_CONTENT,
                "autocomplete": settings.autocomplete,
                "autocorrections": autocorrections,
                "longest": longest,
                "symbolpatterns": symbolpatterns,
                "antipatterns": antipatterns,
                "emojiShortcodes": emojiShortcodes
            };
            // console.log(response);
            sendResponse(response);
        }
    });

    /* browser.tabs.query({}).then((tabs) => {
        for (let tab of tabs) {
            browser.tabs.executeScript(tab.id, {file: "content_scripts/autocorrect.js"});
        }
    }).catch(onError); */
}

BrowserCommunication.addListener(COMMUNICATION_MESSAGE_TYPE.AUTOCORRECT_BACKGROUND, (request) => {
    // clear cache by reloading all options
    // await AddonSettings.loadOptions();

    return sendSettings(request.optionValue);
});
