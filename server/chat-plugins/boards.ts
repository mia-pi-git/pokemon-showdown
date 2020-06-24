import {FS} from '../../lib/fs';
import {Utils} from '../../lib/utils';

let BoardData: AnyObject;
try {
	BoardData = JSON.parse(FS('config/chat-plugins/boards.json').readIfExistsSync() || "{}");
} catch (e) {
	BoardData = {}
}

function saveData() {
	return FS('config/chat-plugins/boards.json').writeUpdate(() => JSON.stringify(BoardData));
}

export class Board {
	title: string;
	threads: Map<string, Thread>;
	constructor(title: string) {
		this.title = title;
		this.threads = this.load();
	}
	load() {
		const threads = new Map();
		for (const title in BoardData) {
			const entry = BoardData[this.title][title];
			threads.set(
				toID(title),
				new Thread(entry.title, entry.poster, this.title, toID(title), entry.replies, entry.canReply)
			);
		}
		return threads;
	}
	save() {

	}
	view() {

	}
}

export class Thread {
	title: string;
	id: string;
	poster: string;
	board: string;
	replies: string[];
	canReply: boolean;
	constructor(title: string, poster: string, board: string, id: string, replies: string[], canReply: boolean) {
		this.title = title;
		this.id = id;
		this.poster = poster;
		this.board = board;
		this.replies = replies;
		this.canReply = canReply;
	}
	save() {
		BoardData[this.board][this.title] = {
			poster: this.poster,
			title: this.title,
			replies: this.replies,
		};
		return saveData();
	}
	display() {
		let buf = `<div class="pad"><a roomid="view-board-${this.id}">◂ ${this.title}</a><br/ ><strong>${this.title}</strong><hr/ >`;
		buf += `${this.replies[0]}<br/ >`;
		buf += ``
	}
	reply(reply: string) {
		if (!this.canReply) return false;

	}
	delete() {
		delete BoardData[this.board][this.title];
		return FS('config/chat-plugins/boards.json').writeUpdate(() => JSON.stringify(BoardData));
	}
}
