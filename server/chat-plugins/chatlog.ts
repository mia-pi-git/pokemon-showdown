/**
 * Pokemon Showdown log viewer
 *
 * by Zarel
 * @license MIT
 */

import {FS} from "../../lib/fs";
import {Utils} from '../../lib/utils';
import * as Dashycode from '../../lib/dashycode';
import * as Sqlite from 'better-sqlite3';

const DAY = 24 * 60 * 60 * 1000;
export const database = new Sqlite(`${__dirname}/../../databases/roomlogs.db`);

interface SearchOptions {
	user?: string;
	search?: string;
	date?: string | null;
	regex?: string;
}

database.function(`to_date`, timestamp => {
	return Chat.toTimestamp(new Date(Number(timestamp))).split(' ')[0];
});

database.function(`to_month`, timestamp => {
	return Chat.toTimestamp(new Date(Number(timestamp))).split(' ')[0].slice(0, -3);
});

database.function(`match_search`, (line, regex) => {
	if (!regex) return 1; // userid
	return Number(new RegExp(regex).test(line));
});

export class LogReaderRoom {
	roomid: RoomID;
	constructor(roomid: RoomID) {
		this.roomid = roomid;
	}

	listMonths() {
		const results = database.prepare(`SELECT to_month(timestamp) FROM roomlogs WHERE room = ?`).pluck(true).all(this.roomid);
		return results.filter((item, index) => results.indexOf(item) === index);
	}

	listDays(month: string) {
		const results = database.prepare(`SELECT to_date(timestamp) FROM roomlogs WHERE room = ?`)
			.pluck(true)
			.all(this.roomid);
		return results.filter((item, index) => {
			return results.indexOf(item) === index && item.slice(0, -3) === month;
		});
	}
	getLogs(day: string) {
		return database.prepare(
			`SELECT line FROM roomlogs WHERE room = ? AND to_date(timestamp) = ?`
		).pluck(true).all(this.roomid, day) as string[];
	}
}

const LogReader = new class {
	get(roomid: RoomID) {
		const existsQuery = database.prepare(`SELECT * FROM roomlogs WHERE room = ?`).all(roomid);
		if (existsQuery.length < 1) return null;
		return new LogReaderRoom(roomid);
	}

	list() {
		const results = database.prepare(`SELECT room FROM roomlogs`).pluck(true).all()
		return results.filter((item, index)=> {
			return results.indexOf(item) === index;
		}) as RoomID[];
	}

	listCategorized(user: User, opts?: string) {
		const list = this.list();
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

		for (const roomid of list) {
			const room = Rooms.get(roomid);
			const forceShow = room && (
				// you are authed in the room
				(room.auth.has(user.id) && user.can('mute', null, room)) ||
				// you are staff and currently in the room
				(isStaff && user.inRooms.has(room.roomid))
			);
			if (!isUpperStaff && !forceShow) {
				if (!isStaff) continue;
				if (!room) continue;
				if (!room.checkModjoin(user)) continue;
				if (room.settings.isPrivate === true) continue;
			}

			atLeastOne = true;
			if (roomid.includes('-')) {
				const matchesOpts = opts && roomid.startsWith(`${opts}-`);
				if (matchesOpts || opts === 'all' || forceShow) {
					(room ? personal : deletedPersonal).push(roomid);
				}
			} else if (!room) {
				if (opts === 'all' || opts === 'deleted') deleted.push(roomid);
			} else if (room.settings.isOfficial) {
				official.push(roomid);
			} else if (!room.settings.isPrivate) {
				normal.push(roomid);
			} else if (room.settings.isPrivate === 'hidden') {
				hidden.push(roomid);
			} else {
				secret.push(roomid);
			}
		}

		if (!atLeastOne) return null;
		return {official, normal, hidden, secret, deleted, personal, deletedPersonal};
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
	results: number;
	constructor() {
		this.results = 0;
	}
	async day(roomid: RoomID, day: string, opts?: string) {
		const month = LogReader.getMonth(day);
		let buf = `<div class="pad"><p>` +
			`<a roomid="view-chatlog">◂ All logs</a> / ` +
			`<a roomid="view-chatlog-${roomid}">${roomid}</a> /  ` +
			`<a roomid="view-chatlog-${roomid}--${month}">${month}</a> / ` +
			`<strong>${day}</strong></p><hr />`;

		const roomLog = LogReader.get(roomid);
		if (!roomLog) {
			buf += `<p class="message-error">Room "${roomid}" doesn't exist</p></div>`;
			return this.linkify(buf);
		}

		const prevDay = LogReader.prevDay(day);
		buf += `<p><a roomid="view-chatlog-${roomid}--${prevDay}" class="blocklink" style="text-align:center">▲<br />${prevDay}</a></p>` +
			`<div class="message-log" style="overflow-wrap: break-word">`;

		const rawLogs = roomLog.getLogs(day);
		buf += rawLogs.map(item => this.renderLine(item, opts)).join('');
		buf += `</div>`;
		if (day !== LogReader.today()) {
			const nextDay = LogReader.nextDay(day);
			buf += `<p><a roomid="view-chatlog-${roomid}--${nextDay}" class="blocklink" style="text-align:center">${nextDay}<br />▼</a></p>`;
		}

		buf += `</div>`;
		return this.linkify(buf);
	}

	renderLine(fullLine: string, opts?: string) {
		if (!fullLine) return ``;
		let timestamp = fullLine.slice(0, opts ? 8 : 5);
		let line;
		if (/^[0-9:]+$/.test(timestamp)) {
			line = fullLine.charAt(9) === '|' ? fullLine.slice(10) : '|' + fullLine.slice(9);
		} else {
			timestamp = '';
			line = '!NT|';
		}
		if (opts !== 'all' && (
			line.startsWith(`userstats|`) ||
			line.startsWith('J|') || line.startsWith('L|') || line.startsWith('N|')
		)) return ``;

		const cmd = line.slice(0, line.indexOf('|'));
		switch (cmd) {
		case 'c': {
			const [, name, message] = Utils.splitFirst(line, '|', 2);
			if (name.length <= 1) {
				return `<div class="chat"><small>[${timestamp}] </small><q>${Chat.formatText(message)}</q></div>`;
			}
			if (message.startsWith(`/log `)) {
				return `<div class="chat"><small>[${timestamp}] </small><q>${Chat.formatText(message.slice(5))}</q></div>`;
			}
			if (message.startsWith(`/raw `)) {
				return `<div class="notice">${message.slice(5)}</div>`;
			}
			if (message.startsWith(`/uhtml `) || message.startsWith(`/uhtmlchange `)) {
				if (message.startsWith(`/uhtmlchange `)) return ``;
				if (opts !== 'all') return `<div class="notice">[uhtml box hidden]</div>`;
				return `<div class="notice">${message.slice(message.indexOf(',') + 1)}</div>`;
			}
			const group = name.charAt(0) !== ' ' ? `<small>${name.charAt(0)}</small>` : ``;
			return `<div class="chat"><small>[${timestamp}] </small><strong>${group}${name.slice(1)}:</strong> <q>${Chat.formatText(message)}</q></div>`;
		}
		case 'html': case 'raw': {
			const [, html] = Utils.splitFirst(line, '|', 1);
			return `<div class="notice">${html}</div>`;
		}
		case 'uhtml': case 'uhtmlchange': {
			if (cmd !== 'uhtml') return ``;
			const [, , html] = Utils.splitFirst(line, '|', 2);
			return `<div class="notice">${html}</div>`;
		}
		case '!NT':
			return `<div class="chat">${Utils.escapeHTML(fullLine)}</div>`;
		case '':
			return `<div class="chat"><small>[${timestamp}] </small>${Utils.escapeHTML(line.slice(1))}</div>`;
		default:
			return `<div class="chat"><small>[${timestamp}] </small><code>${'|' + Utils.escapeHTML(line)}</code></div>`;
		}
	}

	async month(roomid: RoomID, month: string) {
		let buf = `<div class="pad"><p>` +
			`<a roomid="view-chatlog">◂ All logs</a> / ` +
			`<a roomid="view-chatlog-${roomid}">${roomid}</a> / ` +
			`<strong>${month}</strong></p><hr />`;

		const roomLog = LogReader.get(roomid);
		if (!roomLog) {
			buf += `<p class="message-error">Room "${roomid}" doesn't exist</p></div>`;
			return this.linkify(buf);
		}

		const prevMonth = LogReader.prevMonth(month);
		buf += `<p><a roomid="view-chatlog-${roomid}--${prevMonth}" class="blocklink" style="text-align:center">▲<br />${prevMonth}</a></p><div>`;

		const days = roomLog.listDays(month);
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
	room(roomid: RoomID) {
		let buf = `<div class="pad"><p>` +
			`<a roomid="view-chatlog">◂ All logs</a> / ` +
			`<strong>${roomid}</strong></p><hr />`;

		const roomLog = LogReader.get(roomid);
		if (!roomLog) {
			buf += `<p class="message-error">Room "${roomid}" doesn't exist</p></div>`;
			return this.linkify(buf);
		}

		const months = roomLog.listMonths();
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
	async list(user: User, opts?: string) {
		let buf = `<div class="pad"><p>` +
			`<strong>All logs</strong></p><hr />`;

		const categories: {[k: string]: string} = {
			'official': "Official",
			'normal': "Public",
			'hidden': "Hidden",
			'secret': "Secret",
			'deleted': "Deleted",
			'personal': "Personal",
			'deletedPersonal': "Deleted Personal",
		};
		const list = LogReader.listCategorized(user, opts) as {[k: string]: RoomID[]};

		if (!list) {
			buf += `<p class="message-error">You must be a staff member of a room to view its logs</p></div>`;
			return buf;
		}

		const showPersonalLink = opts !== 'all' && user.can('rangeban');
		for (const k in categories) {
			if (!list[k].length && !(['personal', 'deleted'].includes(k) && showPersonalLink)) {
				continue;
			}
			buf += `<p>${categories[k]}</p>`;
			if (k === 'personal' && showPersonalLink) {
				if (opts !== 'help') buf += `<p>- <a roomid="view-chatlog--help">(show all help)</a></p>`;
				if (opts !== 'groupchat') buf += `<p>- <a roomid="view-chatlog--groupchat">(show all groupchat)</a></p>`;
			}
			if (k === 'deleted' && showPersonalLink) {
				if (opts !== 'deleted') buf += `<p>- <a roomid="view-chatlog--deleted">(show deleted)</a></p>`;
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

/** Match with two lines of context in either direction */
type SearchMatch = readonly [string, string, string, string, string];

export const LogSearcher = new class {
	constructRegex(str: string) {
		// modified regex replace
		str = str.replace(/[\\^$.*?()[\]{}|]/g, '\\$&');
		const searches = str.split('+');
		if (searches.length <= 1) {
			if (str.length <= 3) return `\b${str}`;
			return str;
		}

		return `^` + searches.map(term => `(?=.*${term})`).join('');
	}
	search(roomid: RoomID, searchOpts: SearchOptions) {
		let statement = `SELECT line, to_date(timestamp) FROM roomlogs WHERE room = ?`;
		if (!('user' in searchOpts) && !('search' in searchOpts)) {
			throw new Chat.ErrorMessage(`You must search for either a user or a search term.`);
		}
		const user = searchOpts.user;
		if (user) {
			statement += ` AND userid = $user`;
		}
		if ('date' in searchOpts) {
			// if it's null, search all
			if (searchOpts.date !== null) statement += ` AND to_date(timestamp) = $date`;
		}
		const search = searchOpts.search;
		if (search) {
			statement += ` AND match_search(line, $regex) = 1`;
			searchOpts.regex = this.constructRegex(search);
		}
		statement += ` ORDER BY timestamp DESC`;
		const searchResults = database.prepare(statement).all(roomid, searchOpts);
		let buf = `<div class="pad"><h2>Results for search "${search ? search : user ? user : null}" on room "${roomid}"</h2>`
		let curDate = '';
		buf += searchResults.map(item => {
			let {line} = item;
			const timestamp = item['to_date(timestamp)'];
			let prefix = '<hr />';
			if (curDate !== timestamp) {
				curDate = timestamp;
				prefix = `</div></details><details open><summary><a roomid="view-chatlog-${roomid}--${timestamp}"</a></summary>`;
			}
			const regex = search ?
				new RegExp(this.constructRegex(search)) : user ?
				new RegExp(`\|(?:${Config.groupsranking.join('|')})${user}\|`) : null;
			if (regex?.test(line)) {
				line = `<div class="chat chatmessage highlighted">${LogViewer.renderLine(line)}</div>`;
			} else {
				line = LogViewer.renderLine(line);
			}
			if (!line) return;
			return LogViewer.linkify(`${prefix}${line}`);
		}).filter(Boolean).join('');
		buf += `</div>`;
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
		let [roomid, date, opts] = Utils.splitFirst(args.join('-'), '--', 2) as
			[RoomID, string | undefined, string | undefined];
		if (!roomid || roomid.startsWith('-')) {
			this.title = '[Logs]';
			return LogViewer.list(user, roomid?.slice(1));
		}

		// permission check
		const room = Rooms.get(roomid);
		if (roomid.startsWith('spl') && roomid !== 'splatoon' && !user.can('rangeban')) {
			return LogViewer.error("SPL team discussions are super secret.");
		}
		if (roomid.startsWith('wcop') && !user.can('rangeban')) {
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
		/** null = no limit */
		let limit: number | null = null;
		let search;
		if (opts?.startsWith('search-')) {
			let [input, limitString] = opts.split('--limit-');
			input = input.slice(7);
			search = Dashycode.decode(input);
			if (search.length < 3) return LogViewer.error(`Too short of a search query.`);
			if (limitString) {
				limit = parseInt(limitString) || null;
			} else {
				limit = 500;
			}
			opts = '';
		}
		const isAll = (toID(date) === 'all' || toID(date) === 'alltime');

		const parsedDate = new Date(date as string);
		const validDateStrings = ['all', 'alltime', 'today'];
		// this is apparently the best way to tell if a date is invalid
		if (date && isNaN(parsedDate.getTime()) && !validDateStrings.includes(toID(date))) {
			return LogViewer.error(`Invalid date.`);
		}

		if (date && search) {
			this.title = `[Search] [${room}] ${search}`;
			if (!room) return this.errorReply(`Room does not exist.`) // TODO support global log search;
			const searchOpts: SearchOptions = {date: isAll ? null : date, search: search};
			return LogSearcher.search(room.roomid, searchOpts);
		} else if (date) {
			if (date === 'today') {
				return LogViewer.day(roomid, LogReader.today(), opts);
			} else if (date.split('-').length === 3) {
				return LogViewer.day(roomid, parsedDate.toISOString().slice(0, 10), opts);
			} else {
				return LogViewer.month(roomid, parsedDate.toISOString().slice(0, 7));
			}
		} else {
			return LogViewer.room(roomid);
		}
	},
};

export const commands: ChatCommands = {
	chatlog(target, room, user) {
		const targetRoom = target ? Rooms.search(target) : room;
		const roomid = targetRoom ? targetRoom.roomid : target;
		this.parse(`/join view-chatlog-${roomid}--today`);
	},
	chatloghelp: [
		`/chatlog [optional room] - View chatlogs from the given room. If none is specified, shows logs from the room you're in. Requires: % @ * # &`,
	],

	sl: 'searchlogs',
	searchlog: 'searchlogs',
	searchlogs(target, room) {
		if (!room) return this.requiresRoom();
		target = target.trim();
		const args = target.split(',').map(item => item.trim());
		if (!target) return this.parse('/help searchlogs');
		let date = 'all';
		const searches: string[] = [];
		let limit = '500';
		let tarRoom = room.roomid;
		for (const arg of args) {
			if (arg.startsWith('room:')) {
				const id = arg.slice(5);
				tarRoom = id as RoomID;
			} else if (arg.startsWith('limit:')) {
				limit = arg.slice(6);
			} else if (arg.startsWith('date:')) {
				date = arg.slice(5);
			} else {
				searches.push(arg);
			}
		}
		const curRoom = tarRoom ? Rooms.search(tarRoom) : room;
		return this.parse(
			`/join view-chatlog-${curRoom}--${date}--search-${Dashycode.encode(searches.join('+'))}--limit-${limit}`
		);
	},
	searchlogshelp() {
		const buffer = `<details class="readmore"><summary><code>/searchlogs [arguments]</code>: ` +
			`searches logs in the current room using the <code>[arguments]</code>.</summary>` +
			`A room can be specified using the argument <code>room: [roomid]</code>. Defaults to the room it is used in.<br />` +
			`A limit can be specified using the argument <code>limit: [number less than or equal to 3000]</code>. Defaults to 500.<br />` +
			`A date can be specified in ISO (YYYY-MM-DD) format using the argument <code>date: [month]</code> (for example, <code>date: 2020-05</code>). Defaults to searching all logs.<br />` +
			`All other arguments will be considered part of the search ` +
			`(if more than one argument is specified, it searches for lines containing all terms).<br />` +
			"Requires: % @ # &</div>";
		return this.sendReplyBox(buffer);
	},
};
