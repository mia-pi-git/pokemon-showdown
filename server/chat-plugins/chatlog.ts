/**
 * Pokemon Showdown log viewer
 *
 * by Zarel
 * @license MIT
 */

import {FS} from "../../lib/fs";
import * as child_process from 'child_process';
import * as util from 'util';
import * as path from 'path';

export const execFile = util.promisify(child_process.execFile);

const DAY = 24 * 60 * 60 * 1000;

class LogReaderRoom {
	roomid: RoomID;
	constructor(roomid: RoomID) {
		this.roomid = roomid;
	}

	async listMonths() {
		try {
			const listing = await FS(`logs/chat/${this.roomid}`).readdir();
			return listing.filter(file => /^[0-9][0-9][0-9][0-9]-[0-9][0-9]$/.test(file));
		} catch (err) {
			return [];
		}
	}

	async listDays(month: string) {
		try {
			const listing = await FS(`logs/chat/${this.roomid}/${month}`).readdir();
			return listing.filter(file => /\.txt$/.test(file)).map(file => file.slice(0, -4));
		} catch (err) {
			return [];
		}
	}

	async getLog(day: string) {
		const month = LogReader.getMonth(day);
		const log = FS(`logs/chat/${this.roomid}/${month}/${day}.txt`);
		if (!await log.exists()) return null;
		return log.createReadStream();
	}
}

const LogReader = new class {
	async get(roomid: RoomID) {
		if (!await FS(`logs/chat/${roomid}`).exists()) return null;
		return new LogReaderRoom(roomid);
	}

	async list() {
		const listing = await FS(`logs/chat`).readdir();
		return listing.filter(file => /^[a-z0-9-]+$/.test(file)) as RoomID[];
	}

	async listCategorized(user: User, opts?: string[]) {
		const list = await this.list();
		const isUpperStaff = user.can('rangeban');
		const isStaff = user.can('lock');

		const official = [];
		const normal = [];
		const hidden = [];
		const secret = [];
		const deleted = [];
		const personal: RoomID[] = [];
		const deletedPersonal: RoomID[] = [];
		let atLeastOne = false;
		opts = opts?.map(item => toID(item)).filter(item => item);
		for (const roomid of list) {
			const room = Rooms.get(roomid);
			const forceShow = room && (
				// you are authed in the room
				(room.auth && user.id in room.auth && user.can('mute', null, room)) ||
				// you are staff and currently in the room
				(isStaff && user.inRooms.has(room.roomid))
			);
			if (!isUpperStaff && !forceShow) {
				if (!isStaff) continue;
				if (!room) continue;
				if (!room.checkModjoin(user)) continue;
				if (room.isPrivate === true) continue;
			}

			atLeastOne = true;
			if (roomid.includes('-')) {
				const matchesOpts = opts && roomid.startsWith(`${opts}-`);
				if (matchesOpts || opts?.includes('all') || forceShow) {
					(room ? personal : deletedPersonal).push(roomid);
				}
			} else if (!room) {
				if (opts?.includes('all') || opts?.includes('deleted')) deleted.push(roomid);
			} else if (room.isOfficial) {
				official.push(roomid);
			} else if (!room.isPrivate) {
				normal.push(roomid);
			} else if (room.isPrivate === 'hidden') {
				hidden.push(roomid);
			} else {
				secret.push(roomid);
			}
		}

		if (!atLeastOne) return null;
		return {official, normal, hidden, secret, deleted, personal, deletedPersonal};
	}

	async read(roomid: RoomID, day: string) {
		const month = day.slice(0, -3);
		const log = FS(`logs/chat/${roomid}/${month}/${day}.txt`);
		if (!await log.exists()) return null;
		const text = await log.read();
		return text;
	}

	getMonth(day: string) {
		return day.slice(0, 7);
	}
	nextDay(day: string) {
		const nextDay = new Date(new Date(day).getTime() + DAY);
		return nextDay.toISOString().slice(0, 10);
	}
	prevDay(day: string) {
		const prevDay = new Date(new Date(day).getTime() - DAY);
		return prevDay.toISOString().slice(0, 10);
	}
	nextMonth(month: string) {
		const nextMonth = new Date(new Date(`${month}-15`).getTime() + 30 * DAY);
		return nextMonth.toISOString().slice(0, 7);
	}
	prevMonth(month: string) {
		const prevMonth = new Date(new Date(`${month}-15`).getTime() - 30 * DAY);
		return prevMonth.toISOString().slice(0, 7);
	}

	today() {
		return Chat.toTimestamp(new Date()).slice(0, 10);
	}
};

export const LogViewer = new class {
	async day(roomid: RoomID, day: string, opts?: string[]) {
		const month = LogReader.getMonth(day);
		let buf = `<div class="pad"><p>` +
			`<a roomid="view-chatlog">◂ All logs</a> / ` +
			`<a roomid="view-chatlog-${roomid}">${roomid}</a> /  ` +
			`<a roomid="view-chatlog-${roomid}--${month}">${month}</a> / ` +
			`<strong>${day}</strong></p><hr />`;

		const roomLog = await LogReader.get(roomid);
		if (!roomLog) {
			buf += `<p class="message-error">Room "${roomid}" doesn't exist</p></div>`;
			return this.linkify(buf);
		}

		const prevDay = LogReader.prevDay(day);
		buf += `<p><a roomid="view-chatlog-${roomid}--${prevDay}" class="blocklink" style="text-align:center">▲<br />${prevDay}</a></p>` +
			`<div class="message-log" style="overflow-wrap: break-word">`;

		const stream = await roomLog.getLog(day);
		if (!stream) {
			buf += `<p class="message-error">Room "${roomid}" doesn't have logs for ${day}</p>`;
		} else {
			let line;
			while ((line = await stream.readLine()) !== null) {
				buf += this.renderLine(line, opts);
			}
		}

		buf += `</div>`;
		if (day !== LogReader.today()) {
			const nextDay = LogReader.nextDay(day);
			buf += `<p><a roomid="view-chatlog-${roomid}--${nextDay}" class="blocklink" style="text-align:center">${nextDay}<br />▼</a></p>`;
		}

		buf += `</div>`;
		return this.linkify(buf);
	}


	async searchDay(roomid: RoomID, day: string, search: string, cap?: number, prevResults?: string[]) {
		const text = await LogReader.read(roomid, day);
		if (!text) return [];
		const lines = text.split('\n');
		const matches: string[] = [];
		const all: string[] = [];
		const searches = search.split('-');

		if (prevResults) {
			// add previous results to all, to track all matches relative to the cap
			for (const p of prevResults) all.push(p);
		}

		const searchInputs = (phrase: string, terms: string[]) => (
			terms.every((word) => {
				return new RegExp(word, "i").test(phrase);
			})
		);

		for (const line of lines) {
			if (searchInputs(line, searches)) {
				const lineNum: number = lines.indexOf(line);
				const context = (up = true, num: number) => {
					if (up) {
						return this.renderLine(`${lines[lineNum + num]}`);
					} else {
						return this.renderLine(`${lines[lineNum - num]}`);
					}
				};
				const full = (
					`${context(false, 1)} ${context(false, 2)}` +
					`<div class="chat chatmessage highlighted">${this.renderLine(line)}</div>` +
					`${context(true, 1)} ${context(true, 2)}`
				);
				// there's a cap and the total has been met
				if (cap && all.push(full) > cap) break;
				// there's a cap and it is met with this push
				if (matches.push(full) === cap) break;
			}
		}
		return matches;
	}

	async searchMonth(roomid: RoomID, month: string, search: string, cap?: number | string, year = false) {
		const log = await LogReader.get(roomid);
		if (!log) return LogViewer.error(`No logs on ${roomid}.`);
		const days = await log.listDays(month);
		const results = [];
		const searches = search.split('-').length;

		if (typeof cap === 'string') cap = parseInt(cap);

		let buf = (
			`<br><div class="pad"><strong>Results for search (es) ` +
			`"${searches > 1 ? search.split('-').join(' ') : search}"` +
			` on ${roomid}: (${month}):</strong><hr>`
		);
		for (const day of days) {
			const matches: string[] = await this.searchDay(roomid, day, search, cap, results);
			for (const match of matches) results.push(match);
			buf += `<details><summary>Matches on ${day}: (${matches.length})</summary><br><hr>`;
			buf += `<p>${matches.join('<hr>')}</p>`;
			buf += `</details><hr>`;
			if (cap && results.length >= cap && !year) {
				// cap is met & is not being used in a year read
				buf += `<br><strong>Max results reached, capped at ${cap}</strong>`;
				buf += `<br><div style="text-align:center">`;
				buf += `<button class="button" name="send" value="/sl ${search}|${roomid}|${month}|${cap + 100}">View 100 more<br />&#x25bc;</button>`;
				buf += `<button class="button" name="send" value="/sl ${search}|${roomid}|${month}|all">View all<br />&#x25bc;</button></div>`;
				break;
			}
		}
		buf += `</div>`;
		return buf;
	}

	async searchYear(roomid: RoomID, year: string, search: string, alltime = false, cap?: string | number) {
		const log = await LogReader.get(roomid);
		if (!log) return LogViewer.error(`No matches found for ${search} on ${roomid}.`);
		let buf = '';
		if (!alltime) {
			buf += `<strong><br>Searching year: ${year}: </strong><hr>`;
		}	else {
			buf += `<strong><br>Searching all logs: </strong><hr>`;
		}
		if (typeof cap === 'string') cap = parseInt(cap);
		const months = await log.listMonths();
		for (const month of months) {
			if (buf.includes('capped')) {
				// cap has been met in a previous loop, add the buttons and break.
				buf += `<br /><div style="text-align:center">`;
				buf += `<button class="button" name="send" value="/sl ${search}|${roomid}|${year}|${cap! + 100}">View 100 more<br />&#x25bc;</button>`;
				buf += `<button class="button" name="send" value="/sl ${search}|${roomid}|${year}|all">View all<br />&#x25bc;</button></div>`;
				break;
			}
			if (!month.includes(year) && !alltime) continue;
			if (!FS(`logs/chat/${roomid}/${month}/`).isDirectorySync()) continue;
			buf += await this.searchMonth(roomid, month, search, cap, true);
			buf += '<br>';
		}
		return buf;
	}

	renderLine(fullLine: string, opts?: string[]) {
		if (!fullLine) return ``;
		let timestamp = fullLine.slice(0, opts ? 8 : 5);
		let line;
		if (/^[0-9:]+$/.test(timestamp)) {
			line = fullLine.charAt(9) === '|' ? fullLine.slice(10) : '|' + fullLine.slice(9);
		} else {
			timestamp = '';
			line = '!NT|';
		}
		const blacklist = opts?.filter(item => item.slice(0, -item.length +1) === '!')
			.map(item => item.replace('!', ''));
		//filter input args
		if (!opts?.includes('all') && (
			line.startsWith(`userstats|`) ||
			line.startsWith('J|') || line.startsWith('L|') || line.startsWith('N|')
		)) return ``;

		const cmd = line.slice(0, line.indexOf('|'));
		if (blacklist?.includes(toID(cmd))) return '';
		switch (cmd) {
		case 'c': {
			const [, name, message] = Chat.splitFirst(line, '|', 2);
			if (name.length <= 1) {
				return `<div class="chat"><small>[${timestamp}] </small><q>${Chat.formatText(message)}</q></div>`;
			}
			if (message.startsWith(`/log `)) {
				return `<div class="chat"><small>[${timestamp}] </small><q>${Chat.formatText(message.slice(5))}</q></div>`;
			}
			if (message.startsWith(`/raw `)) {
				if (blacklist?.includes('raw')) return '';
				return `<div class="notice">${message.slice(5)}</div>`;
			}
			if (message.startsWith(`/uhtml `) || message.startsWith(`/uhtmlchange `)) {
				if (blacklist?.includes('uhtml')) return '';
				return `<div class="notice">${message.slice(message.indexOf(',') + 1)}</div>`;
			}
			const group = name.charAt(0) !== ' ' ? `<small>${name.charAt(0)}</small>` : ``;
			return `<div class="chat"><small>[${timestamp}] </small><strong>${group}${name.slice(1)}:</strong> <q>${Chat.formatText(message)}</q></div>`;
		}
		case 'html': case 'raw': {
			const [, html] = Chat.splitFirst(line, '|', 1);
			return `<div class="notice">${html}</div>`;
		}
		case 'uhtml': case 'uhtmlchange': {
			const [, , html] = Chat.splitFirst(line, '|', 2);
			return `<div class="notice">${html}</div>`;
		}
		case '!NT':
			return `<div class="chat">${Chat.escapeHTML(fullLine)}</div>`;
		case '':
			return `<div class="chat"><small>[${timestamp}] </small>${Chat.escapeHTML(line.slice(1))}</div>`;
		default:
			return `<div class="chat"><small>[${timestamp}] </small><code>${'|' + Chat.escapeHTML(line)}</code></div>`;
		}
	}

	async month(roomid: RoomID, month: string) {
		let buf = `<div class="pad"><p>` +
			`<a roomid="view-chatlog">◂ All logs</a> / ` +
			`<a roomid="view-chatlog-${roomid}">${roomid}</a> / ` +
			`<strong>${month}</strong></p><hr />`;

		const roomLog = await LogReader.get(roomid);
		if (!roomLog) {
			buf += `<p class="message-error">Room "${roomid}" doesn't exist</p></div>`;
			return this.linkify(buf);
		}

		const prevMonth = LogReader.prevMonth(month);
		buf += `<p><a roomid="view-chatlog-${roomid}--${prevMonth}" class="blocklink" style="text-align:center">▲<br />${prevMonth}</a></p><div>`;

		const days = await roomLog.listDays(month);
		if (!days.length) {
			buf += `<p class="message-error">Room "${roomid}" doesn't have logs in ${month}</p></div>`;
			return this.linkify(buf);
		} else {
			for (const day of days) {
				buf += `<p>- <a roomid="view-chatlog-${roomid}--${day}">${day}</a></p>`;
			}
		}

		if (!LogReader.today().startsWith(month)) {
			const nextMonth = LogReader.nextMonth(month);
			buf += `<p><a roomid="view-chatlog-${roomid}--${nextMonth}" class="blocklink" style="text-align:center">${nextMonth}<br />▼</a></p>`;
		}

		buf += `</div>`;
		return this.linkify(buf);
	}
	async room(roomid: RoomID) {
		let buf = `<div class="pad"><p>` +
			`<a roomid="view-chatlog">◂ All logs</a> / ` +
			`<strong>${roomid}</strong></p><hr />`;

		const roomLog = await LogReader.get(roomid);
		if (!roomLog) {
			buf += `<p class="message-error">Room "${roomid}" doesn't exist</p></div>`;
			return this.linkify(buf);
		}

		const months = await roomLog.listMonths();
		if (!months.length) {
			buf += `<p class="message-error">Room "${roomid}" doesn't have logs</p></div>`;
			return this.linkify(buf);
		}

		for (const month of months) {
			buf += `<p>- <a roomid="view-chatlog-${roomid}--${month}">${month}</a></p>`;
		}
		buf += `</div>`;
		return this.linkify(buf);
	}
	async list(user: User, opts?: string[]) {
		let buf = `<div class="pad"><p>` +
			`<strong>All logs</strong></p><hr />`;
		opts = opts?.map(opt => toID(opt));
		const categories: {[k: string]: string} = {
			'official': "Official",
			'normal': "Public",
			'hidden': "Hidden",
			'secret': "Secret",
			'deleted': "Deleted",
			'personal': "Personal",
			'deletedPersonal': "Deleted Personal",
		};
		const list = await LogReader.listCategorized(user, opts) as {[k: string]: RoomID[]};

		if (!list) {
			buf += `<p class="message-error">You must be a staff member of a room, to view logs</p></div>`;
			return buf;
		}

		const showPersonalLink = opts?.includes('all') && user.can('rangeban');
		for (const k in categories) {
			if (!list[k].length && !(['personal', 'deleted'].includes(k) && showPersonalLink)) {
				continue;
			}
			buf += `<p>${categories[k]}</p>`;
			if (k === 'personal' && showPersonalLink) {
				if (!opts?.includes('help')) buf += `<p>- <a roomid="view-chatlog--help">(show all help)</a></p>`;
				if (!opts?.includes('groupchat')) buf += `<p>- <a roomid="view-chatlog--groupchat">(show all groupchat)</a></p>`;
			}
			if (k === 'deleted' && showPersonalLink) {
				if (!opts?.includes('deleted')) buf += `<p>- <a roomid="view-chatlog--deleted">(show deleted)</a></p>`;
			}
			for (const roomid of list[k]) {
				buf += `<p>- <a roomid="view-chatlog-${roomid}">${roomid}</a></p>`;
			}
		}
		buf += `</div>`;
		return this.linkify(buf);
	}
	error(message: string) {
		return `<div class="pad"><p class="message-error">${message}</p></div>`;
	}
	linkify(buf: string) {
		return buf.replace(/<a roomid="/g, `<a target="replace" href="/`);
	}
};

const LogSearcher = new class {
	fsSearch(roomid: RoomID, search: string, date: string, cap?: number | string) {
		const isAll = (date === 'all');
		const isYear = (date.length < 0 && date.length > 7);
		const isMonth = (date.length === 7);

		if (isAll) {
			return LogViewer.searchYear(roomid, date, search, true, cap);
		} else if (isYear) {
			date = date.substr(0, 4);
			return LogViewer.searchYear(roomid, date, search, false, cap);
		} else if (isMonth) {
			date = date.substr(0, 7);
			return LogViewer.searchMonth(roomid, date, search, cap);
		} else {
			return LogViewer.error("Invalid date.");
		}
	}

	async ripgrepSearch(roomid: RoomID, search: string, cap: number) {
		let output;
		try {
			const options = [
				search,
				`${__dirname}/../../logs/chat/${roomid}`,
				'-C', '3',
			];
			output = await execFile('rg', options, {maxBuffer: Infinity, cwd: path.normalize(`${__dirname}/../`)});
		} catch (error) {
			if (error.message.includes('Command failed')) return LogViewer.error(`No results found.`);
			return LogViewer.error(`${error.message}`);
		}
		const matches = [];
		for (const result of output.stdout.split('--').reverse()) {
			matches.push(result);
		}
		return this.render(matches, roomid, search, cap);
	}

	render(results: string[], roomid: RoomID, search: string, cap?: number) {
		const dates: string[] = [];
		let count = 0;
		let curDate = '';
		const sorted = results.sort().map(chunk => {
			const section = chunk.split('\n').map(line => {
				const sep = line.includes('.txt-') ? '.txt-' : '.txt:';
				const [name, text] = line.split(sep);
				let rendered = LogViewer.renderLine(text, ['all']);
				if (!rendered || name.includes('today') || !toID(line)) return '';
				 // gets rid of some edge cases / duplicates
				let date = name.replace(`${__dirname}/../../logs/chat/${roomid}`, '').slice(9);
				if (curDate !== date) {
					curDate = date;
					if (!(curDate in dates)) dates.push(curDate);
					date = `</div></details><details><summary>[<a href="view-chatlog-${roomid}--${date}">${date}</a>]</summary>`;
					rendered = `${date} ${rendered}`;
				} else {
					date = '';
				}
				const matched = (
					new RegExp(search, "i")
						.test(rendered) ? `<div class="chat chatmessage highlighted">${rendered}</div>` : rendered
				);
				if (matched.includes('chat chatmessage highlighted')) {
					count++;
				}
				if (cap && count > cap) return null;
				return matched;
			}).filter(item => item).join(' ');
			return section;
		});
		let buf = `<div class ="pad"><strong>Results on ${roomid} for ${search}:</strong>`;
		let total = 0;
		for (const match of results.join(' ').split(' ')) {
			if (new RegExp(search, "i").test(match)) total++;
		}
		buf += ` ${total}`;
		buf += cap ? ` (capped at ${cap})<hr></div><blockquote>` : `<hr></div><blockquote>`;
		buf += sorted.filter(item => item).join('<hr>');
		if (cap && cap !== Infinity) {
			buf += `</details></blockquote><div class="pad"><hr><strong>Capped at ${cap}.</strong><br>`;
			buf += `<button class="button" name="send" value="/sl ${search},${roomid},${Number(cap) + 200}">View 200 more<br />&#x25bc;</button>`;
			buf += `<button class="button" name="send" value="/sl ${search},${roomid},all">View all<br />&#x25bc;</button></div>`;
		}
		return buf;
	}
};

const accessLog = FS(`logs/chatlog-access.txt`).createAppendStream();

export const pages: PageTable = {
	async chatlog(args, user, connection) {
		if (!user.named) return Rooms.RETRY_AFTER_LOGIN;
		if (!user.trusted) {
			return LogViewer.error("Access denied");
		}

		const [roomid, date, opts, cap] = args
			.join('-')
			.split('--') as [RoomID, string | undefined, string | undefined, number];

		if (!roomid || roomid.startsWith('-')) {
			this.title = '[Logs]';
			return LogViewer.list(user, roomid?.slice(1).split('-'));
		}
		const parts = opts?.split('-');
		// permission check
		const room = Rooms.get(roomid);
		if (roomid.startsWith('spl') && roomid !== 'splatoon' && !user.can('rangeban')) {
			return LogViewer.error("SPL team discussions are super secret.");
		}
		if (roomid.startsWith('wcop') &&	!user.can('rangeban')) {
			return LogViewer.error("WCOP team discussions are super secret.");
		}
		if (room) {
			if (!room.checkModjoin(user) && !user.can('bypassall')) {
				return LogViewer.error("Access denied");
			}
			if (!user.can('lock') && !this.can('mute', null, room)) return;
		} else {
			if (!this.can('lock')) return;
		}

		void accessLog.writeLine(`${user.id}: <${roomid}> ${date}`);
		this.title = '[Logs] ' + roomid;

		const hasSearch = opts	?.includes('search&');
		const search = opts?.slice(7);
		const isAll = (toID(date) === 'all' || toID(date) === 'alltime');

		const parsedDate = new Date(date as string);
		// this is apparently the best way to tell if a date is invalid
		if (isNaN(parsedDate.getTime()) && !isAll && date && date !== 'today') {
			return LogViewer.error(`Invalid date.`);
		}

		if (date && !hasSearch) {
			if (date === 'today') {
				return LogViewer.day(roomid, LogReader.today(), parts);
			} else if (date.split('-').length === 3) {
				return LogViewer.day(roomid, parsedDate.toISOString().slice(0, 10), parts);
			} else {
				return LogViewer.month(roomid, parsedDate.toISOString().slice(0, 7));
			}
		} else if (date && hasSearch && search) {
			this.title = `[Search] [${room}] ${search}`;
			if (Config.chatlogreader === 'fs') {
				return LogSearcher.fsSearch(roomid, search, date, toID(cap));
			} else if (Config.chatlogreader === 'ripgrep') {
				return LogSearcher.ripgrepSearch(roomid, search, cap);
			} else {
				return LogViewer.error(
					`<strong>Log searching has been configured incorrectly.<br>` +
					`Please set Config.chatlogreader to 'fs' or 'ripgrep'.</strong>	`
				);
			}
		} else {
			return LogViewer.room(roomid);
		}
	},
};

export const commands: ChatCommands = {
	chatlog(target, room, user) {
		let args = target.split(',').map(item => toID(item));
		let id;
		for (const arg of args) {
			if (Rooms.search(arg) && this.can('mute', null, Rooms.search(arg))) {
				id = Rooms.search(arg);
				args = args.filter(item => !item.includes(arg));
			}
		}
		const targetRoom = id ? id : room;
		const roomid = targetRoom ? targetRoom.roomid : target;
		return this.parse(`/join view-chatlog-${roomid}--today${args.length > 0 ? `--${args.join('-')}` : ''}`);
	},

	sl: 'searchlogs',
	searchlog: 'searchlogs',
	searchlogs(target, room) {
		target = target.trim();
		const [search, tarRoom, cap, date] = target.split(',') as [string, string, number, number];
		if (!target) return this.parse('/help searchlogs');
		if (!search) return this.errorReply('Specify a query to search the logs for.');
		if (cap && isNaN(cap) && toID(cap) !== 'all') return this.errorReply(`Cap must be a number or [all].`);
		const input = search.includes('|') ? search.split('|').map(item => item.trim()).join('-') : search;
		const currentMonth = Chat.toTimestamp(new Date()).split(' ')[0].slice(0, -3);
		const curRoom = tarRoom ? Rooms.search(tarRoom) : room;
		const limit = cap ? `--${cap}` : `--500`;
		return this.parse(`/join view-chatlog-${curRoom}--${date ? date : currentMonth}--search&${input}${limit}`);
	},

	searchlogshelp: [
		"/searchlogs [search], [room], [cap], [date] - searches logs in the current room for [search].",
		"A comma can be used to search for multiple words in a single line - in the format arg1, arg2, etc.",
		"If a [cap] is given, limits it to only that many lines. Defaults to 500.",
		"Requires: % @ # & ~",
	],
};
