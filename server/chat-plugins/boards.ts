import {FS} from '../../lib/fs';
import {Utils} from '../../lib/utils';

export let BoardData: AnyObject;
try {
	BoardData = JSON.parse(FS('config/chat-plugins/boards.json').readIfExistsSync() || "{}");
} catch (e) {
	BoardData = {}
}

function saveData() {
	return FS('config/chat-plugins/boards.json').writeUpdate(() => JSON.stringify(BoardData));
}

function getBoard(board: string) {

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
	}
	load() {
		const threads = new Map();
		for (const title in BoardData[this.id]) {
			const entry = BoardData[this.id][toID(title)];
			threads.set(toID(title), new Thread(entry));
		}
		return threads;
	}
	save() {
		for (const thread of this.threads.values()) {
			thread.save();
		}
		return saveData();
	}
	display() {
		let buf = `<div class="pad"><h2>${this.title}</h2>`;
		for (const thread of this.threads.values()) {
			buf += thread.preview();
			buf += `<br/ >`	;
		}
		buf += `</div>`;
		return buf;
	}
	post(title: string, options: AnyObject) {
		const thread = new Thread(options);
		this.threads.set(title, thread);
		this.save();
		return thread;
	}

}

export class Thread {
	title: string;
	id: string;
	poster: string;
	board: string;
	replies: Post[];
	postDate: number;
	lastActivity?: number;
	canReply?: boolean;
	post: Post;
	constructor(options: AnyObject) {
		this.title = options.title;
		this.id = toID(this.title);
		this.poster = options.poster;
		this.board = options.board;
		this.replies = options.replies ? options.replies : [];
		this.post = options.post;
		this.lastActivity = options.lastActivity ? options.lastActivity : Date.now();
		this.postDate = options.postDate ? options.postDate : Date.now();
		this.canReply = options.canReply ? options.canReply : true;
	}
	save() {
		if (!BoardData[this.board]) BoardData[this.board] = {};
		if (!BoardData[this.board][this.title]) BoardData[this.board][this.title] = {};

		BoardData[this.board][this.title] = {
			poster: this.poster,
			title: this.title,
			replies: this.replies,
		};
		return saveData();
	}
	display() {
		let buf = `<div class="pad"><a roomid="view-board-${this.board}">◂ ${this.board} / ${this.title}</a><br/ ><hr/ >`;
		buf += `<h3>${this.title}</h3>`;
		buf += `<div class="infobox">Poster: <strong>${this.poster}</strong><br/ ><small> Replies: (${this.replies.length})`;
		buf += `</small><hr/ >${this.post}</div><br/ >`;
		for (const reply of this.sortReplies()) {
			buf += `<div class="infobox"><strong>${reply.poster}</strong>: `;
			buf += `<small>${Chat.toDurationString(Date.now() - reply.postTime)} ago</small><hr/ >`;
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
			postTime: Date.now()
		});
		this.save();
	}
	delete() {
		delete BoardData[this.board][this.title];
		return saveData();
	}
	preview() {
		let buf = `<hr/ ><a roomid="view-board-${this.id}">${this.title}</a><hr/ >`;
		buf += `Posted: ${Chat.toTimestamp(new Date(this.postDate), {human: true})}<br/ >`;
		if (this.lastActivity) buf += `Last activity: ${Chat.toTimestamp(new Date(this.lastActivity), {human: true})}`;
		buf += `${this.replies[0].message.slice(0, -200)}${this.replies[0].message.length > 200 ? '(...)' : ''}<br/ >`;
		buf += `Comments: ${this.replies.length}<br/ >`;
		buf += `Poster: ${this.poster}<hr/ >`;
		return buf.replace(/<a roomid="/g, `<a target="replace" href="/`);
	}
	sortReplies() {
		this.replies.sort((a, b) => {
			return b.postTime - a.postTime;
		});
		return this.replies;
	}
}

export const boards: Map<string, Board> = new Map();

for (const board in BoardData) {
	boards.set(board, new Board(board, BoardData[board]));
}

export const boardCommands = {};
export const pages: PageTable = {};

export const commands: ChatCommands = {};

for (const [k] of boards) {
	commands[k] = boardCommands;
}
