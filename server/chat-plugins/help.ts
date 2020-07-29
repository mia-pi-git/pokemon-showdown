/**
 * PS Help room auto-response plugin.
 * Uses Regex to match room frequently asked question (RFAQ) entries,
 * and replies if a match is found.
 *
 * Written by mia-pi.
 */

import {FS} from '../../lib/fs';
import {Utils} from '../../lib/utils';
import {LogViewer} from './chatlog';
import {ROOMFAQ_FILE} from './room-faqs';
const PATH = 'config/chat-plugins/help.json';
const MINIMUM_LENGTH = 7;
const helpRoom = Rooms.get('help');
const REGEX_WHITELIST = ['miapi', 'annika', 'kris'];

export let helpData: PluginData;

try {
	helpData = JSON.parse(FS(PATH).readIfExistsSync() || "{}");
} catch (e) {
	helpData = {
		stats: {},
		pairs: {},
		disabled: false,
		queue: [],
	};
}
/** Terms commonly used in helping that should be ignored
 *  within question parsing (the Help#find function). */
const COMMON_TERMS = [
	'<<(.+)>>', '(do|use|type)( |)(``|)(/|!|//)(.+)(``|)', 'go to', '/rfaq (.+)', 'you can', Chat.linkRegex, 'click',
	'need to',
].map(item => new RegExp(item, "i"));

/**
 * A message filtered by the AI.
 */
interface LoggedMessage {
	/** Message that's matched by the AI. */
	message: string;
	/** The FAQ that it's matched to. */
	faqName: string;
	/** The regex that it's matched to. */
	regex: string;
}
/** Object of stats for that day. */
interface DayStats {
	matches?: LoggedMessage[];
	total?: number;
}
interface PluginData {
	/** Stats - filter match and faq that was matched - done day by day. */
	stats?: {[k: string]: DayStats};
	/** Word pairs that have been marked as a match for a specific FAQ. */
	pairs: {[k: string]: string[]};
	/** Whether or not the filter is disabled. */
	disabled?: boolean;
	/** Queue of suggested regex. */
	queue?: string[];
}

export class HelpAnswerer {
	roomFaqs: AnyObject;
	disabled?: boolean;
	queue: string[];
	data: PluginData;
	constructor(helpData: PluginData) {
		this.data = helpData;
		this.roomFaqs = this.loadFaqs();
		this.queue = helpData.queue ? helpData.queue : [];

		FS(ROOMFAQ_FILE).onModify(() => {
			// refresh on modifications to keep it up to date
			this.roomFaqs = this.loadFaqs();
		});
	}
	find(question: string, user?: User) {
		const faqs: string[] = Object.keys((this.roomFaqs || '{}'))
		.filter(item => item.length >= 6 && !this.roomFaqs[item].startsWith('>'));
		for (const term of COMMON_TERMS) {
			if (term.test(question)) return null;
		}
		for (const faq of faqs) {
			const match = this.match(question, faq);
			if (match) {
				if (user) {
					const timestamp = Chat.toTimestamp(new Date()).split(' ')[1];
					const log = `${timestamp} |c| ${user.name}|${question}`;
					this.log(log, faq, match.regex);
				}
				return this.roomFaqs[match.faq];
			}
		}
		return null;
	}
	visualize(question: string, hideButton?: boolean, user?: User) {
		const response = this.find(question, user);
		if (response) {
			let buf = '';
			buf += Utils.html`<strong>You said:</strong> ${question}<br />`;
			buf += `<strong>Our automated reply:</strong> ${Chat.formatText(response)}`;
			question = Utils.escapeHTML(question);
			if (!hideButton) {
				buf += `<hr /><button class="button" name="send" value="A: ${question}">`;
				buf += `Send to the Help room if you weren't answered correctly or wanted to help </button>`;
			}
			return buf;
		}
		return null;
	}
	getFaqID(faq: string) {
		const alias: string = this.roomFaqs[faq];
		if (!alias) return;
		// ignore short aliases, they cause too many false positives
		if (faq.length < MINIMUM_LENGTH || alias.length < MINIMUM_LENGTH) return;
		if (alias.charAt(0) !== '>') return faq; // not an alias
		return alias.replace('>', '');
	}
	stringRegex(str: string, user?: User) {
		str = str.split('=>')[0];
		const args = str.split(',').map(item => item.trim());
		// if (args.length < 2) throw new Chat.ErrorMessage("You need more than 2 arguments.");
		return args.map(item => {
			const split = item.split('&').map(string => {
				// allow raw regex for admins and whitelisted users
				if (user?.can('rangeban') || REGEX_WHITELIST.includes(user?.id as string)) return string.trim();
				// escape otherwise
				return string.replace(/[\\^$.*+?()[\]{}]/g, '\\$&').trim();
			});
			return split.map(term => {
				if (term.startsWith('!')) {
					return `^(?!.*${term.slice(1)})`;
				}
				if (!term.trim()) return null;
				return `(?=.*?(${term.trim()}))`;
			}).filter(Boolean).join('');
		}).filter(Boolean).join('');
	}
	validateRegex(regex: string) {
		try {
			new RegExp(regex).test('');
		} catch (e) {
			if (e.message.includes("regular expression")) throw new Chat.ErrorMessage(e.message);
			throw e;
		}
		return true;
	}
	match(question: string, faq: string) {
		const regexes = this.data.pairs[faq];
		if (!regexes) return;
		for (const regex of regexes) {
			const regexString = new RegExp(regex);
			if (regexString.test(Chat.normalize(question))) return {faq, regex};
		}
		return;
	}
	log(entry: string, faq: string, expression: string) {
		if (!this.data.stats) this.data.stats = {};
		const day = Chat.toTimestamp(new Date).split(' ')[0];
		if (!this.data.stats[day]) this.data.stats[day] = {};
		const today = this.data.stats[day];
		const log: LoggedMessage = {
			message: entry,
			faqName: faq,
			regex: expression,
		};
		const stats = {
			matches: today.matches ? today.matches : [],
			total: today.matches ? today.matches.length : 0,
		};
		const dayLog = Object.assign(this.data.stats[day], stats);
		dayLog.matches.push(log);
		dayLog.total++;
		return this.writeState();
	}
	writeState() {
		return FS(PATH).writeUpdate(() => JSON.stringify(this.data));
	}
	loadFaqs() {
		return JSON.parse(FS(ROOMFAQ_FILE).readIfExistsSync() || `{"help":{}}`).help;
	}
	getFaq(faq: string): string {
		const name = this.getFaqID(faq);
		return name ? Chat.normalize(this.roomFaqs[name]) : '';
	}
	addRegex(inputString: string, user?: User) {
		let [args, faq] = inputString.split('=>');
		faq = this.getFaqID(toID(faq)) as string;
		if (!faq) throw new Chat.ErrorMessage("Invalid FAQ.");
		if (!this.data.pairs) this.data.pairs = {};
		if (!this.data.pairs[faq]) this.data.pairs[faq] = [];
		const regex = this.stringRegex(args, user);
		this.validateRegex(regex);
		this.data.pairs[faq].push(regex);
		return this.writeState();
	}
	removeRegex(faq: string, index: number) {
		faq = this.getFaqID(faq) as string;
		if (!faq) throw new Chat.ErrorMessage("Invalid FAQ.");
		if (!this.data.pairs) this.data.pairs = {};
		if (!this.data.pairs[faq]) throw new Chat.ErrorMessage(`There are no regexes for ${faq}.`);
		if (!this.data.pairs[faq][index]) throw new Chat.ErrorMessage("Your provided index is invalid.");
		this.data.pairs[faq].splice(index, 1);
		this.writeState();
		return true;
	}
};

const Answerer = new HelpAnswerer(helpData);

export const chatfilter: ChatFilter = (message, user, room) => {
	if (room?.roomid === 'help' && room.auth.get(user.id) === ' ' && !Answerer.disabled) {
		const reply = Answerer.visualize(message, false, user);
		if (message.startsWith('/') || message.startsWith('!')) return message;
		if (!reply) {
			return message;
		} else {
			if (message.startsWith('a:') || message.startsWith('A:')) return message.replace(/(a|A):/, '');
			user.sendTo(room.roomid, `|uhtml|askhelp-${user}-${toID(message)}|<div class="infobox">${reply}</div>`);
			const trimmedMessage = `<div class="infobox">${Answerer.visualize(message, true)}</div>`;
			setTimeout(() => {
				user.sendTo(
					room.roomid,
					`|c| ${user.name}|/uhtmlchange askhelp-${user}-${toID(message)}, ${trimmedMessage}`
				);
			}, 10 * 1000);
			return false;
		}
	}
};

export const commands: ChatCommands = {
	question(target, room, user) {
		if (!target) return this.parse("/help question");
		const reply = Answerer.visualize(target, true);
		if (!reply) return this.sendReplyBox(`No answer found.`);
		this.runBroadcast();
		this.sendReplyBox(reply);
	},
	questionhelp: ["/question [question] - Asks the Help Room auto-response plugin a question."],

	hf: 'helpfilter',
	helpfilter: {
		''(target) {
			if (!target) {
				this.parse('/help helpfilter');
				return this.sendReply(`The Help auto-response filter is currently set to: ${Answerer.disabled ? 'OFF' : "ON"}`);
			}
			return this.parse(`/j view-helpfilter-${target}`);
		},
		toggle(target, room, user) {
			if (!room) return this.requiresRoom();
			if (room.roomid !== 'help') return this.errorReply(`This command is only available in the Help room.`);
			if (!target) {
				return this.sendReply(`The Help auto-response filter is currently set to: ${Answerer.disabled ? 'OFF' : "ON"}`);
			}
			if (!this.can('ban', null, room)) return false;
			if (this.meansYes(target)) {
				if (!Answerer.disabled) return this.errorReply(`The Help auto-response filter is already enabled.`);
				Answerer.disabled = false;
			}
			if (this.meansNo(target)) {
				if (Answerer.disabled) return this.errorReply(`The Help auto-response filter is already disabled.`);
				Answerer.disabled = true;
			}
			Answerer.writeState();
			this.privateModAction(`(${user.name} ${Answerer.disabled ? 'disabled' : 'enabled'} the Help auto-response filter.)`);
			this.modlog(`HELPFILTER`, null, Answerer.disabled ? 'off' : 'on');
		},
		stats: 'viewstats',
		viewstats(target, room, user) {
			if (!helpRoom) return this.errorReply(`No Help Room to view stats for.`);
			if (!this.can('mute', null, helpRoom)) return false;
			if (toID(target) === 'today') target = Chat.toTimestamp(new Date()).split(' ')[0];
			return this.parse(`/join view-helpfilter-stats-${target ? target : ''}`);
		},
		keys: 'viewkeys',
		viewkeys(target, room, user) {
			if (!helpRoom) return this.errorReply(`No Help Room to view regex keys for.`);
			if (!this.can('mute', null, helpRoom)) return false;
			return this.parse('/j view-helpfilter-keys');
		},
		forceadd: 'add',
		add(target, room, user, connection, cmd) {
			if (room?.roomid !== 'help') return this.errorReply(`This command is only available in the Help room.`);
			if (!helpRoom) return this.errorReply(`No Help room to manage the filter for.`);
			const force = cmd === 'forceadd';
			if (force && (!REGEX_WHITELIST.includes(user.id) && !user.can('rangeban'))) {
				return this.errorReply(`You cannot use raw regex - it will be escaped.`);
			}
			if (!this.can('show', null, helpRoom)) return false;
			if (!user.authAtLeast('@', helpRoom)) return this.parse(`/hf queue ${target}`);
			Answerer.addRegex(target, force ? user : undefined);
			this.privateModAction(`(${user.name} added regex for "${target.split('=>')[0]}" to the filter.)`);
			this.modlog(`HELPFILTER ADD`, null, target);
		},
		remove(target, room, user) {
			if (!helpRoom) return this.errorReply(`No Help room to manage the filter for.`);
			if (!this.can('ban', null, helpRoom)) return false;
			const [faq, index] = target.split(',');
			const num = parseInt(index);
			if (isNaN(num)) return this.errorReply("Invalid index.");
			Answerer.removeRegex(faq, num - 1);
			helpRoom.sendModsByUser(user, `(${user.name} removed ${faq} regex ${num} from the usable regexes.)`);
			this.modlog('HELPFILTER REMOVE', null, index);
		},
		queue(target, room, user) {
			if (room?.roomid !== 'help') return this.errorReply(`This command is only available in the Help room.`);
			if (!helpRoom) return this.errorReply(`No Help room to manage the filter for.`);
			if (!this.can('show', null, helpRoom)) return false;
			if (!target) return this.errorReply(`Specify regex.`);
			const faq = Answerer.getFaqID(target.split('=>')[1].trim());
			if (!faq) return this.errorReply(`Invalid FAQ.`);
			const regex = Answerer.stringRegex(target);
			Answerer.validateRegex(regex);
			Answerer.queue.push(target);
			Answerer.writeState();
			return this.sendReply(`Added "${target}" to the regex suggestion queue.`);
		},
		approve(target, room, user) {
			if (!helpRoom) return this.errorReply(`No Help room to manage the filter for.`);
			if (!this.can('ban', null, helpRoom)) return false;
			const index = parseInt(target) - 1;
			if (isNaN(index)) return this.errorReply(`Invalid queue index.`);
			const str = Answerer.queue[index];
			if (!str) return this.errorReply(`Item does not exist in queue.`);
			const regex = Answerer.stringRegex(str);
			// validated on submission
			const faq = Answerer.getFaqID(str.split('=>')[1].trim());
			if (!faq) return this.errorReply(`Invalid FAQ.`);
			if (!Answerer.data.pairs[faq]) helpData.pairs[faq] = [];
			Answerer.data.pairs[faq].push(regex);
			Answerer.queue.splice(index, 1);
			Answerer.writeState();
			helpRoom.sendModsByUser(user, `(${user.name} approved regex for use with queue number ${target}`);
			this.modlog(`HELPFILTER APPROVE`, null, `${target}`);
		},
		deny(target, room, user) {
			if (!helpRoom) return this.errorReply(`No Help room to manage the filter for.`);
			if (!this.can('ban', null, helpRoom)) return false;
			target = target.trim();
			const index = parseInt(target) - 1;
			if (isNaN(index)) return this.errorReply(`Invalid queue index.`);
			if (!Answerer.queue[index]) throw new Chat.ErrorMessage(`Item does not exist in queue.`);
			Answerer.queue.splice(index, 1);
			Answerer.writeState();
			helpRoom.sendModsByUser(user, `(${user.name} denied regex with queue number ${target})`);
			this.modlog(`HELPFILTER DENY`, null, `${target}`);
		},
	},
	helpfilterhelp() {
		const help = [
			`/helpfilter stats - Shows stats for the Help filter (matched lines and the FAQs that match them.)`,
			`/helpfilter toggle [on | off] - Enables or disables the Help filter. Requires: @ # &`,
			`/helpfilter add [regex] => [faq] - Adds regex to the Help filter to respond to lines matching the regex with [faq].`,
			`/helpfilter remove [faq], [regex index] - removes the regex matching the [index] from the Help filter's responses for [faq].`,
			`/helpfilter queue [regex] => [faq] - Adds [regex] for [faq] to the queue for Help staff to review.`,
			`/helpfilter approve [index] - Approves the regex at position [index] in the queue for use in the Help filter.`,
			`/helpfilter deny [index] - Denies the regex at position [index] in the Help filter queue.`,
			`Requires: @ # &`,
		].map(item => {
			const [cmd, text] = item.split('-');
			return `<code>${cmd.trim()}</code> ${text ? `- ${text}` : ''}`;
		});
		return this.sendReplyBox(help.join('<br/ >'));
	},
};

export const pages: PageTable = {
	helpfilter(args, user) {
		if (!helpRoom) return `<h2>No Help room to view data for.</h2>`;
		if (!this.can('mute', null, helpRoom)) return;
		let buf = '';
		const refresh = (type: string, extra?: string[]) => {
			let button = `<button class="button" name="send" value="/join view-helpfilter-${type}`;
			button += `${extra ? `-${extra.join('-')}` : ''}" style="float: right">`;
			button += `<i class="fa fa-refresh"></i> Refresh</button><br />`;
			return button;
		};
		const main = `<br/><a roomid="view-helpfilter">Back to all</a>`;
		switch (args[0]) {
		case 'stats':
			args.shift();
			const date = args.join('-') || '';
			if (!!date && isNaN(new Date(date).getTime())) {
				return `<h2>Invalid date.</h2>`;
			}
			buf = `<div class="pad"><strong>Stats for the Help auto-response filter${date ? ` on ${date}` : ''}.</strong>`;
			buf += `${main}${refresh('stats', [date])}<hr />`;
			const stats = helpData.stats;
			if (!stats) return `<h2>No stats.</h2>`;
			this.title = `[Help Stats] ${date ? date : ''}`;
			if (date) {
				if (!stats[date]) return `<h2>No stats for ${date}.</h2>`;
				buf += `<strong>Total messages answered: ${stats[date].total}</strong><hr />`;
				buf += `<details><summary>All messages and the corresponding answers (FAQs):</summary>`;
				if (!stats[date].matches) return `<h2>No logs.</h2>`;
				for (const entry of stats[date].matches!) {
					buf += `<small>Message:</small>${LogViewer.renderLine(entry.message)}`;
					buf += `<small>FAQ: ${entry.faqName}</small><br />`;
					buf += `<small>Regex: <code>${entry.regex}</code></small> <hr />`;
				}
				return buf;
			}
			buf += `<strong> No date specified.<br />`;
			buf += `Dates with stats:</strong><br />`;
			for (const key in stats) {
				buf += `- <a roomid="view-helpfilter-stats-${key}">${key}</a> (${stats[key].total})<br />`;
			}
			break;
		case 'keys':
			this.title = '[Help Regexes]';
			buf = `<div class="pad"><h2>Help filter regexes and responses:</h2>${main}${refresh('keys')}<hr />`;
			buf += Object.keys(helpData.pairs).map(item => {
				const regexes = helpData.pairs[item];
				if (regexes.length < 1) return null;
				let buffer = `<details><summary>${item}</summary>`;
				for (const regex of regexes) {
					const index = regexes.indexOf(regex) + 1;
					const button = `<button class="button" name="send"value="/hf remove ${item}, ${index}">Remove</button>`;
					buffer += `- <small><code>${regex}</code> ${button} (index ${index})</small><br />`;
				}
				buffer += `</details>`;
				return buffer;
			}).filter(Boolean).join('<hr />');
			break;
		case 'queue':
			this.title = `[Help Queue]`;
			buf = `<div class="pad"><h2>Regexes queued for review.</h2>${main}${refresh('queue')}<hr />`;
			if (!helpData.queue) helpData.queue = [];
			for (const request of helpData.queue) {
				const faq = request.split('=>')[1];
				buf += `<strong>FAQ: ${faq}</strong><hr />`;
				buf += Answerer.stringRegex(request);
				const index = helpData.queue.indexOf(request) + 1;
				buf += `<br /><button class="button" name="send"value="/hf approve ${index}">Approve</button>`;
				buf += `<button class="button" name="send"value="/hf deny ${index}">Deny</button>`;
				buf += `<hr /><br />`;
			}
			buf += '</div>';
			break;
		default:
			this.title = '[Help Filter]';
			buf = `<div class="pad"><h2>Specify a filter page to view.</h2>`;
			buf += `<hr /><strong>Options:</strong><hr />`;
			buf += `<a roomid="view-helpfilter-stats">Stats</a><hr />`;
			buf += `<a roomid="view-helpfilter-keys">Regex keys</a><hr/>`;
			buf += `<a roomid="view-helpfilter-queue">Queue</a><hr/>`;
			buf += `</div>`;
		}
		return LogViewer.linkify(buf);
	},
};
