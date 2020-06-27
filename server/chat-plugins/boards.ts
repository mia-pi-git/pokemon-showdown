import {FS} from '../../lib/fs';
import {Utils} from '../../lib/utils';

export let BoardData: AnyObject = {};
try {
	BoardData = JSON.parse(FS('config/chat-plugins/boards.json').readIfExistsSync() || "{}");
} catch (e) {}

function saveData() {
	return FS('config/chat-plugins/boards.json').writeUpdate(() => JSON.stringify(BoardData));
}

interface Post {
	poster: string,
	message: string,
	postTime: number,
}

export class Board {
	title: string;
	threads: Map<string, Thread>;
	viewRank?: string;
	id: ID;
	constructor(title: string, options: AnyObject = {}) {
		this.title = title;
		this.threads = this.load();
		this.id = toID(title);
		this.viewRank = options.viewRank ? options.viewRank : ' ';
		this.save();
	}
	load() {
		const threads = new Map();
		for (const title in BoardData[this.title]) {
			const entry = BoardData[this.title][title];
			threads.set(toID(title), new Thread(title, entry.post, entry));
		}
		return threads;
	}
	save() {
		if (!BoardData[this.title]) BoardData[this.title] = {};
		for (const thread of this.threads.values()) {
			thread.save();
		}
		return saveData();
	}
	display() {
		let buf = `<div class="pad"><h2>${this.title}</h2>Threads: ${this.threads.size}<hr/ >`;
		this.sortThreads();
		if (this.threads.size < 1) {
			buf += `<strong>No threads yet.</strong>`;
			return buf;
		}
		for (const thread of this.threads.values()) {
			buf += thread.preview();
			buf += `<br/ >`	;
		}
		buf += `</div>`;
		return buf;
	}
	post(title: string, post: string, user: string, canReply?: boolean) {
		const options: AnyObject = {
			title: title,
			post: post,
			poster: user,
			canReply: canReply ? canReply : true,
			postDate: Date.now(),
			replies: [],
			board: this.title,
		};
		const thread = new Thread(title, post, options);
		this.threads.set(title, thread);
		this.save();
		return thread;
	}
	sortThreads() {
		this.threads = new Map(
			[...this.threads].sort((a, b) => {
				return (b[1].lastActivity || 2) - (a[1].lastActivity || 1);
			})
		);
		return this.threads;
	}
	destroy() {
		delete BoardData[this.id];
		for (const [id, thread] of this.threads) {
			threads.delete(id);
			thread.destroy();
		}
		boards.delete(this.id);
		return saveData();
	}
	preview() {
		let buf = `<div class="infobox"><strong>${this.title}</strong><hr/ >`;
		const mostRecent = [...this.sortThreads().values()][0];
		buf += `Threads: ${this.threads.size}<br/ >`;
		buf += `<small><a roomid="view-board-${mostRecent.id}">${mostRecent.title}</a>`;
		buf += ` (${date(mostRecent.lastActivity ? mostRecent.lastActivity : mostRecent.postDate)})<br/ >`;
		buf += `</small></div>`;
		return buf.replace(/<a roomid="/g, `<a target="replace" href="/`);
	}
}

export class Thread {
	title: string;
	id: string;
	poster: string;
	board: string;
	replies: Post[];
	postDate: number;
	post: string;
	lastActivity?: number;
	canReply?: boolean;
	constructor(title: string, post: string, options: AnyObject) {
		this.title = title;
		this.id = toID(this.title);
		this.poster = options.poster;
		this.board = options.board;
		this.replies = options.replies ? options.replies : [];
		this.post = post;
		this.lastActivity = options.lastActivity ? options.lastActivity : Date.now();
		this.postDate = options.postDate ? options.postDate : Date.now();
		this.canReply = options.canReply ? options.canReply : true;
		threads.set(this.id, this);
	}
	save() {
		if (!BoardData[this.board]) BoardData[this.board] = {};
		BoardData[this.board][this.title] = {
			poster: this.poster,
			title: this.title,
			replies: this.replies,
			canReply: this.canReply,
			lastActivity: this.lastActivity,
			postDate: this.postDate,
			post: this.post,
			board: this.board,
		};
		return saveData();
	}
	display() {
		let buf = `<div class="pad"><a roomid="view-board-${toID(this.board)}">◂ ${this.board}</a> / ${this.title}<br/ ><hr/ >`;
		buf += `<h3>${this.title}</h3>`;
		buf += `<div class="infobox">Poster: <strong>${this.poster}</strong><br/ ><small> Replies: (${this.replies.length})`;
		buf += `</small><hr/ >${this.post}</div><br/ >`;
		for (const reply of this.sortReplies()) {
			buf += `<div class="infobox"><strong>${reply.poster} </strong><small>(#${this.replies.indexOf(reply) + 1})</small>: `;
			buf += `<small>${timeSince(reply.postTime)}</small><hr/ >`;
			buf +=`${Utils.escapeHTML(reply.message)}</div><br/ >`;
		}
		return buf.replace(/<a roomid="/g, `<a target="replace" href="/`);
	}
	reply(reply: string, user: string, override?: boolean) {
		if (!this.canReply && !override) return false;
		this.lastActivity = Date.now();
		this.replies.push({
			poster: user,
			message: reply,
			postTime: Date.now(),
		});
		this.save();
	}
	destroy() {
		threads.delete(this.id);
		delete BoardData[this.board][this.title];
		return saveData();
	}
	preview() {
		let buf = `<hr/ ><a roomid="view-thread-${this.id}">${this.title}</a><hr/ >`;
		buf += `Posted: ${date(this.postDate)}<br/ >`;
		if (this.lastActivity) buf += `Last activity: ${date(this.lastActivity)}<br/ >`;
		buf += `Comments: ${this.replies.length}<br/ >`;
		buf += `Poster: ${this.poster}<br/ ><strong>`;
		buf += `</strong><hr/ ><br/ >`;
		return buf.replace(/<a roomid="/g, `<a target="replace" href="/`);
	}
	sortReplies() {
		this.replies.sort((a, b) => {
			return a.postTime - b.postTime;
		});
		return this.replies;
	}
}
export const boards: Map<string, Board> = new Map();
export const threads: Map<string, Thread> = new Map();

function timeSince(time: number) {
	const day = 24 * 60 * 60 * 1000;
	const week = 7 * day;
	const opts: {[k: string]: boolean} = {};
	if (Date.now() - time < 1000) return `Now`;
	if (Date.now() - time > week) return date(time);
	if (Date.now() - time > day) opts['hhmmss'] = true;
	return `${Chat.toDurationString(Date.now() - time, opts)} ago`;
}

function date(date: number) {
	return Chat.toTimestamp(new Date(date), {human: true});
}

function createBoard(title: string, opts?: AnyObject) {
	const board = new Board(title, BoardData[title] ? BoardData[title] : opts ? opts : {});
	boards.set(board.id, board);
	return board;
}

function loadBoards() {
	if (boards && boards.size > 0) {
		// refresh board data
		for (const board of boards.values()) {
			board.destroy();
		}
	}
	for (const key in BoardData) {
		createBoard(key, BoardData[key]);
	}
}
function selectBoard(message: string) {
	const id = toID(message.slice(1).split(' ')[0]);
	const board = boards.get(id);
	if (!board) throw new Error(`Invalid board passed to selectBoard`);
	return board;
}

loadBoards();

export const commands: ChatCommands = {
	createboard(target, room, user) {
		if (!this.can('declare')) return false;
		createBoard(target);
		this.privateModAction(`(${user.name} created the board ${target}.)`);
		this.globalModlog(`CREATEBOARD`, null, target);
		loadBoards();
	},
	deleteboard(target, room, user) {
		const id = toID(target).trim();
		const board = boards.get(id);
		if (!this.can('declare')) return false;
		if (!board) return this.errorReply(`Board ${board} does not exist.`);
		board.destroy();
		this.privateModAction(`(${user.name} deleted the board ${target}.)`);
		this.globalModlog(`DELETEBOARD`, null, target);
	},
};
export const pages: PageTable = {
	board(args, user) {
		if (args.length < 1) {
			let buf = `<div class="pad"><h2>All boards:</h2><hr/ >`;
			this.title = `[Boards]`;
			for (const board of boards.values()) {
				if (board.viewRank && !user.authAtLeast(board.viewRank)) continue;
				buf += board.preview();
				buf += `<br>`;
			}
			return buf;
		}
		const board = boards.get(args[0]);
		if (!board) {
			return `<h2>Board not found.</h2>`;
		}
		if (board.viewRank && !user.authAtLeast(board.viewRank)) {
			return `<h2>Access denied.</h2>`;
		}
		return board.display();
	},

	thread(args, user) {
		const thread = threads.get(args[0]);
		if (!thread) return `<h2>Thread not found.</h2>`;
		const board = boards.get(thread.board);
		this.title = `[Thread] ${thread.title}`;
		if (board?.viewRank && !user.authAtLeast(board.viewRank)) {
			return `<h2>Access denied.</h2>`;
		}
		return thread.display();
	}
};

const boardCommands: ChatCommands = {
	reply(target, room, user) {
		if (!target) return this.errorReply(`Specify a thread and content.`);
		const [threadID, post] = target.split(',').map(item => item.trim());
		const board = selectBoard(this.message);
		if (board.viewRank && !user.authAtLeast(board.viewRank)) {
			return this.errorReply(`Access denied.`);
		}
		const thread = threads.get(threadID);
		if (!thread) return this.errorReply(`Thread ${threadID} doesn't exist.`);
		thread.reply(post, user.name, user.isStaff ? true : false);
		this.parse(`/j view-thread-${threadID}`);
	},
	post(target, room, user) {
		if (!target) return this.errorReply(`Specify a title and content.`);
		const [title, post] = Utils.splitFirst(target, ',').map(item => item.trim());
		const allowReplies = Utils.splitFirst(post, '|');
		const board = selectBoard(this.message);
		if (board.viewRank && !user.authAtLeast(board.viewRank)) {
			return this.errorReply(`Access denied.`);
		}
		if (allowReplies && !user.isStaff) {
			return this.errorReply(`You cannot prevent replies without being staff.`);
		}
		board.post(title, post, user.name, allowReplies ? false : true);
		return this.parse(`/join view-threads-${toID(title)}`);
	},
	deletethread(target, room, user) {
		const id = toID(target);
		const thread = threads.get(id);
		if (!thread) {
			return this.errorReply(`Thread ${id} does not exist.`);
		}
		thread.destroy();
		this.globalModlog(`DELETETHREAD`, null, id);
		return this.sendReply(`Deleted thread ${id}.`);
	},
	deletepost(target, room, user) {
		const [id, index, reason] = target.split(',').map(item => item.trim()) as [string, number, string | undefined];
		if (!target) return this.errorReply(`Specify a thread and post number.`);
		const thread = threads.get(toID(id));
		if (!thread) return this.errorReply(`Thread ${id} does not exist.`);
		const post = thread.replies[index - 1];
		if (!post) return this.errorReply(`Post ${index} does not exist.`);
		if (toID(post.poster) !== user.id && !user.isStaff) {
			return this.errorReply(`You cannot delete other's posts.`);
		}
		const idx = thread.replies.indexOf(post);
		thread.replies = thread.replies.splice(idx, 1);
		thread.save();
		if (toID(post.poster) !== user.id) {
			this.globalModlog(`DELETEPOST`, null, `${thread.title}: ${idx + 1}`);
		}
		return this.sendReply(`Deleted post ${idx + 1} in ${thread.title}.`);
	},
	toggleposting(target, room, user) {

	},
	'': 'view',
	view(target, room, user) {
		const board = selectBoard(this.message);
		return this.parse(`/j view-board-${board.id}`);
	},

};
if (!boards.get('suggestions')) createBoard('Suggestions');
if (!boards.get('bugreports')) createBoard('Bug Reports');

for (const k of boards.keys()) {
	commands[k] = boardCommands;
}
