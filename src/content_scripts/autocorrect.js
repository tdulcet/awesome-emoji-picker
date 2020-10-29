"use strict";

// communication type
// directly include magic constant as a workaround as we cannot import modules in content scripts due to https://bugzilla.mozilla.org/show_bug.cgi?id=1451545
const AUTOCORRECT_CONTENT = "autocorrectContent";

let insertedText; // Last insert text
let deletedText; // Last deleted text
let lastTarget; // Last target
let lastCaretPosition; // Last caret position

let autocomplete = true;

let autocorrections = {};

let longest = 0;

// Regular expressions
let symbolpatterns = null;
// Do not autocorrect for these patterns
let antipatterns = null;

let emojiShortcodes = {};

/**
 * Get caret position.
 *
 * @param {Object} target
 * @returns {number}
 */
function getCaretPosition(target) {
	if (target.isContentEditable) {
		target.focus();
		const _range = document.getSelection().getRangeAt(0);
		const range = _range.cloneRange();
		const temp = document.createTextNode("\0");
		range.insertNode(temp);
		const caretposition = target.innerText.indexOf("\0");
		temp.parentNode.removeChild(temp);
		return caretposition;
	} else {
		return target.selectionStart;
	}
}

/**
 * Insert at caret in the given element.
 * Adapted from: https://www.everythingfrontend.com/posts/insert-text-into-textarea-at-cursor-position.html
 *
 * @param {Object} target
 * @param {string} atext
 * @returns {void}
 */
function insertAtCaret(target, atext) {
	const isSuccess = document.execCommand("insertText", false, atext);

	if(isSuccess) {
		return;
	}

	// Firefox input and textarea fields: https://bugzilla.mozilla.org/show_bug.cgi?id=1220696
	if (typeof target.setRangeText === "function") {
		const start = target.selectionStart;
		const end = target.selectionEnd;

		if (start !== undefined && end !== undefined) {
			target.setRangeText(atext);

			target.selectionStart = target.selectionEnd = start + atext.length;

			// Notify any possible listeners of the change
			const event = document.createEvent("UIEvent");
			event.initEvent("input", true, false);
			target.dispatchEvent(event);

			return;
		}
	}

	throw new Error("nothing selected");
}

/**
 * Insert into page.
 *
 * @param {string} atext
 * @returns {void}
 */
function insertIntoPage(atext) {
	return insertAtCaret(document.activeElement, atext);
}

/**
 * Count Unicode characters.
 * Adapted from: https://blog.jonnew.com/posts/poo-dot-length-equals-two
 *
 * @param {string} str
 * @returns {number}
 */
function countChars(str) {
	// removing the joiners
	const split = str.split("\u{200D}");
	let count = 0;

	for (const s of split) {
		// removing the variation selectors
		count += Array.from(s.split(/[\ufe00-\ufe0f]/).join("")).length;
	}

	return count;
}

/**
 * Delete at caret.
 *
 * @param {Object} target
 * @param {string} atext
 * @returns {void}
 */
function deleteCaret(target, atext) {
	const count = countChars(atext);
	if (count > 0) {
		const isSuccess = document.execCommand("delete", false);
		if (isSuccess) {
			for (let i = 0; i < count - 1; ++i) {
				document.execCommand("delete", false);
			}
		}
		// Firefox input and textarea fields: https://bugzilla.mozilla.org/show_bug.cgi?id=1220696
		else if (typeof target.setRangeText === "function") {
			const start = target.selectionStart;

			target.selectionStart = start - atext.length;
			target.selectionEnd = start;
			target.setRangeText("");

			// Notify any possible listeners of the change
			const e = document.createEvent("UIEvent");
			e.initEvent("input", true, false);
			target.dispatchEvent(e);
		}
	}
}

/**
 * Get first difference index.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function firstDifferenceIndex(a, b) {
	if (a === b) {
		return -1;
	}
	let i = 0;
	while (a[i] === b[i]) {
		++i;
	}
	return i;
}

/**
 * Autocorrect on text input even by evaluating the keys and replacing the characters/string.
 *
 * @param {Object} event
 * @returns {void}
 */
function autocorrect(event) {
	// console.log('keydown', event.key, event.key.length, event.keyCode);
	// Exclude all keys that do not produce a single Unicode character
	if (!((event.key.length === 0 || event.key.length === 1 || event.keyCode === 13 || event.key === "Unidentified") && !event.ctrlKey && !event.metaKey && !event.altKey)) {
		return;
	}
	if (!symbolpatterns) {
		throw new Error("Emoji autocorrect settings have not been received. Do not autocorrect.");
	}
	const target = event.target;
	const caretposition = getCaretPosition(target);
	if (caretposition) {
		const value = target.value || target.innerText;
		let deletecount = 0;
		let insert = value.slice(caretposition - 1, caretposition); // event.key;
		let output = false;
		const preivousText = value.slice(caretposition < (longest + 1) ? 0 : caretposition - (longest + 1), caretposition - 1);
		const regexResult = symbolpatterns.exec(preivousText);
		// Autocorrect :colon: Emoji Shortcodes and/or Emoticon Emojis and/or Unicode Symbols
		if (regexResult) {
			const text = value.slice(caretposition < longest ? 0 : caretposition - longest, caretposition);
			const aregexResult = symbolpatterns.exec(text);
			const aaregexResult = antipatterns.exec(text);
			if (!aaregexResult && (!aregexResult || (caretposition <= longest ? regexResult.index < aregexResult.index : regexResult.index <= aregexResult.index))) {
				insert = autocorrections[regexResult[0]] + (event.keyCode === 13 ? "\n" : insert);
				deletecount = regexResult[0].length + 1;
				output = true;
			}
		} else {
			// Autocomplete :colon: Emoji Shortcodes
			if (autocomplete) {
				// Emoji Shortcode
				const re = /:[a-z0-9-+_]+$/;
				const text = value.slice(caretposition < (longest - 1) ? 0 : caretposition - (longest - 1), caretposition);
				const regexResult = re.exec(text);
				if (regexResult) {
					const aregexResult = Object.keys(emojiShortcodes).filter((item) => item.indexOf(regexResult[0]) === 0);
					if (aregexResult.length === 1 && (regexResult[0].length > 2 || aregexResult[0].length === 3)) {
						insert = aregexResult[0].slice(regexResult[0].length);
						output = true;
					}
				}
			}
		}
		if (output) {
			const text = value.slice(caretposition - deletecount, caretposition);
			deleteCaret(target, text);
			insertAtCaret(target, insert);
			console.debug("Autocorrect: “%s” was replaced with “%s”.", text, insert);

			insertedText = insert;
			deletedText = text;

			lastTarget = target;
			lastCaretPosition = caretposition - deletecount + insert.length;
		}
	}
}

/**
 * Undo autocorrect in case the backspace has been pressed.
 *
 * @param {Object} event
 * @returns {void}
 */
function undoAutocorrect(event) {
	// console.log('keyup', event.key, event.key.length, event.keyCode);
	// Backspace
	if (!(event.keyCode === 8 && !event.ctrlKey && !event.metaKey && !event.altKey)) {
		return;
	}
	const target = event.target;
	const caretposition = getCaretPosition(target);
	if (caretposition) {
		if (target === lastTarget && caretposition === lastCaretPosition) {
			event.preventDefault();

			if (insertedText) {
				deleteCaret(target, insertedText);
			}
			if (deletedText) {
				insertAtCaret(target, deletedText);
			}
			console.debug("Undo autocorrect: “%s” was replaced with “%s”.", insertedText, deletedText);
		}
	}

	lastTarget = null;
}

/**
 * Handle response from the autocorrect module.
 *
 * @param {Object} message
 * @param {Object} sender
 * @returns {void}
 */
function handleResponse(message, sender) {
	if (message.type !== AUTOCORRECT_CONTENT) {
		return;
	}
	autocomplete = message.autocomplete;
	autocorrections = message.autocorrections;
	longest = message.longest;
	symbolpatterns = message.symbolpatterns;
	antipatterns = message.antipatterns;
	emojiShortcodes = message.emojiShortcodes;
	// console.log(message);
}

/**
 * Handle errors from messages and responses.
 *
 * @param {string} error
 * @returns {void}
 */
function handleError(error) {
	console.error(`Error: ${error}`);
}

browser.runtime.sendMessage({ "type": AUTOCORRECT_CONTENT }).then(handleResponse, handleError);
browser.runtime.onMessage.addListener(handleResponse);
window.addEventListener("keydown", undoAutocorrect, true);
window.addEventListener("keyup", autocorrect, true);
console.log("AwesomeEmoji autocorrect module loaded");
console.log("AwesomeEmoji autocorrect module loaded.");
