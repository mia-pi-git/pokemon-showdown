/**
 * Raw text to SQLite converter for chatroom logs.
 * Written by mia-pi (mia-pi-git.)
 * Note: None of these validate if the files exist because they _should_ be throwing if they don't exist.
 */
import {FS} from '../../lib/fs';
import * as Sqlite from 'better-sqlite3';
import {Utils} from '../../lib/utils';
import * as Streams from '../../lib/streams';

function getStatement() {
	const db = new Sqlite(`${__dirname}/../../databases/roomlogs.db`);
	return db.prepare(`INSERT INTO roomlogs(room, line, timestamp, userid) VALUES(?, ?, ?, ?)`);
}

function toID(text) {
	// The sucrase transformation of optional chaining is too expensive to be used in a hot function like this.
	/* eslint-disable @typescript-eslint/prefer-optional-chain */
	if (text && text.id) {
		text = text.id;
	} else if (text && text.userid) {
		text = text.userid;
	} else if (text && text.roomid) {
		text = text.roomid;
	}
	if (typeof text !== 'string' && typeof text !== 'number') return '';
	return ('' + text).toLowerCase().replace(/[^a-z0-9]+/g, '') ;
	/* eslint-enable @typescript-eslint/prefer-optional-chain */
}

/**
 * Borrowed from roomlog. Useful for parsing.
 */

export function parseChatLine(line: string) {
	if (line.startsWith('|c|')) {
		line = `|c:|${Math.trunc(Date.now() / 1000)}|${line.slice(3)}`;
	}
	const messageStart = line.includes('|c:|') ? '|c:|' : '|c|';
	const section = line.includes('|c:|') ? 4 : 3; // ['', 'c' timestamp?, author, message]
	if (line.startsWith(messageStart)) {
		const parts = Utils.splitFirst(line, '|', section);
		return {user: parts[section - 1], message: parts[section]};
	}
}

export async function convert() {
	const roomFiles = FS(`logs/chat`).readdirSync().filter(item => FS(`logs/chat/${item}`).isDirectorySync());
	for (const room of roomFiles) {
		await convertRoomLogs(room);
	}
}

function isValidTime(time: string) {
	return !isNaN(new Date(time).getTime())
}

async function convertRoomLogs(room: string) {
	console.log(`Now converting logs for ${room}.`);
	const months = FS(`logs/chat/${room}`).readdirSync().filter(item => FS(`logs/chat/${room}/${item}`).isDirectorySync());
	for (const month of months) {
		await new SQLMonthConverter(room, month).convert();
	}
}

class SQLMonthConverter {
	currentDayStream: Streams.ReadStream | null;
	days: string[];
	month: string;
	room: string;
	currentDay: string;
	constructor(room: string, month: string) {
		this.days = FS(`logs/chat/${room}/${month}`).readdirSync();
		this.month = month;
		this.room = room;
		this.currentDay = '';
		this.currentDayStream = this.getCurrentStream();
	}
	async convert() {
		const statement = getStatement();
		while (this.currentDayStream) {
			let rawLine;
			console.log(`Converting logs for '${this.room}' on day '${this.currentDay}'`)
			while ((rawLine = await this.currentDayStream.readLine()) !== null) {
				const [stamp] = rawLine.split(' ');
				const time = new Date(`${this.currentDay} ${stamp && isValidTime(stamp) ? stamp : ''}`).getTime();
				const parsed = parseChatLine(rawLine);
				statement.run(this.room, rawLine, time, parsed ? toID(parsed.user) : null);
			}
			this.currentDayStream = this.getCurrentStream();
		}
	}
	getCurrentStream() {
		const day = this.days.shift();
		if (!day) return;
		this.currentDay = day.slice(0, -4);
		return FS(`logs/chat/${this.room}/${this.month}/${day}`).createReadStream();
	}
}
