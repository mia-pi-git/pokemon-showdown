/**
 * Roomlogs
 * Pokemon Showdown - http://pokemonshowdown.com/
 *
 * This handles data storage for rooms.
 *
 * @license MIT
 */

import {FS} from '../lib/fs';
import {Utils} from '../lib/utils';
import type {ModlogEntry} from './modlog';
import * as Sqlite from 'better-sqlite3';

interface RoomlogOptions {
	isMultichannel?: boolean;
	noAutoTruncate?: boolean;
	noLogTimes?: boolean;
}

/**
 * Most rooms have three logs:
 * - scrollback
 * - roomlog
 * - modlog
 * This class keeps track of all three.
 *
 * The scrollback is stored in memory, and is the log you get when you
 * join the room. It does not get moderator messages.
 *
 * The modlog is stored in
 * `logs/modlog/modlog_<ROOMID>.txt`
 * It contains moderator messages, formatted for ease of search.
 * Direct modlog access is handled in modlog.ts; this file is just
 * a wrapper to make other code more readable.
 *
 * The roomlog is stored in
 * `logs/chat/<ROOMID>/<YEAR>-<MONTH>/<YEAR>-<MONTH>-<DAY>.txt`
 * It contains (nearly) everything.
 */
export class Roomlog {
	/**
	 * Battle rooms are multichannel, which means their logs are split
	 * into four channels, public, p1, p2, full.
	 */
	readonly isMultichannel: boolean;
	/**
	 * Chat rooms auto-truncate, which means it only stores the recent
	 * messages, if there are more.
	 */
	readonly noAutoTruncate: boolean;
	/**
	 * Chat rooms include timestamps.
	 */
	readonly noLogTimes: boolean;
	/** Database to write to. */
	readonly database: Sqlite.Database;
	/** Object of statements prepared on initalization. */
	readonly statements: {[k: string]: Sqlite.Statement};
	roomid: RoomID;
	/**
	 * Scrollback log
	 */
	log: string[];
	broadcastBuffer: string[];
	constructor(room: BasicRoom, options: RoomlogOptions = {}) {
		this.roomid = room.roomid;

		this.isMultichannel = !!options.isMultichannel;
		this.noAutoTruncate = !!options.noAutoTruncate;
		this.noLogTimes = !!options.noLogTimes;

		this.log = [];
		this.broadcastBuffer = [];

		Rooms.Modlog.initialize(this.roomid);
		try {
			this.database = new Sqlite(`${__dirname}/../databases/roomlogs.db`, {fileMustExist: true});
		} catch (e) {
			this.database = new Sqlite(`${__dirname}/../databases/roomlogs.db`);
			this.database.exec(FS(`databases/schemas/roomlogs.sql`).readIfExistsSync());
		}
		this.statements = {
			insert: this.database.prepare(`INSERT INTO roomlogs (line, timestamp, room, user) VALUES(?, ?, ?, ?)`),
			rename: this.database.prepare(`UPDATE roomlogs SET room = ? WHERE room = ?`),
			roomlogExists: this.database.prepare(`SELECT room FROM roomlogs WHERE room = ?`),
		}
	}
	getScrollback(channel = 0) {
		let log = this.log;
		if (!this.noLogTimes) log = [`|:|${~~(Date.now() / 1000)}`].concat(log);
		if (!this.isMultichannel) {
			return log.join('\n') + '\n';
		}
		log = [];
		for (let i = 0; i < this.log.length; ++i) {
			const line = this.log[i];
			const split = /\|split\|p(\d)/g.exec(line);
			if (split) {
				const canSeePrivileged = (channel === Number(split[0]) || channel === -1);
				const ownLine = this.log[i + (canSeePrivileged ? 1 : 2)];
				if (ownLine) log.push(ownLine);
				i += 2;
			} else {
				log.push(line);
			}
		}
		return log.join('\n') + '\n';
	}
	add(message: string) {
		this.roomlog(message);
		message = this.withTimestamp(message);
		this.log.push(message);
		this.broadcastBuffer.push(message);
		return this;
	}
	withTimestamp(message: string) {
		if (!this.noLogTimes && message.startsWith('|c|')) {
			return `|c:|${Math.trunc(Date.now() / 1000)}|${message.slice(3)}`;
		} else {
			return message;
		}
	}
	hasUsername(username: string) {
		const userid = toID(username);
		for (const line of this.log) {
			if (line.startsWith('|c:|')) {
				const curUserid = toID(line.split('|', 4)[3]);
				if (curUserid === userid) return true;
			} else if (line.startsWith('|c|')) {
				const curUserid = toID(line.split('|', 3)[2]);
				if (curUserid === userid) return true;
			}
		}
		return false;
	}
	clearText(userids: ID[], lineCount = 0) {
		const cleared: ID[] = [];
		const clearAll = (lineCount === 0);
		this.log = this.log.reverse().filter(line => {
			const parsed = this.parseChatLine(line);
			if (parsed) {
				const userid = toID(parsed.user);
				if (userids.includes(userid)) {
					if (!cleared.includes(userid)) cleared.push(userid);
					if (this.roomid.startsWith('battle-')) return true; // Don't remove messages in battle rooms to preserve evidence
					if (clearAll) return false;
					if (lineCount > 0) {
						lineCount--;
						return false;
					}
					return true;
				}
			}
			return true;
		}).reverse();
		return cleared;
	}
	uhtmlchange(name: string, message: string) {
		const originalStart = '|uhtml|' + name + '|';
		const fullMessage = originalStart + message;
		for (const [i, line] of this.log.entries()) {
			if (line.startsWith(originalStart)) {
				this.log[i] = fullMessage;
				break;
			}
		}
		this.broadcastBuffer.push(fullMessage);
	}
	attributedUhtmlchange(user: User, name: string, message: string) {
		const start = `/uhtmlchange ${name},`;
		const fullMessage = this.withTimestamp(`|c|${user.getIdentity()}|${start}${message}`);
		for (const [i, line] of this.log.entries()) {
			if (this.parseChatLine(line)?.message.startsWith(start)) {
				this.log[i] = fullMessage;
				break;
			}
		}
		this.broadcastBuffer.push(fullMessage);
	}
	parseChatLine(line: string) {
		const messageStart = !this.noLogTimes ? '|c:|' : '|c|';
		const section = !this.noLogTimes ? 4 : 3; // ['', 'c' timestamp?, author, message]
		if (line.startsWith(messageStart)) {
			const parts = Utils.splitFirst(line, '|', section);
			return {user: parts[section - 1], message: parts[section]};
		}
	}
	roomlog(message: string, date = new Date()) {
		message = message.replace(/<img[^>]* src="data:image\/png;base64,[^">]+"[^>]*>/g, '');
		const parsed = this.parseChatLine(message);
		this.statements.insert.run(message, Date.now(), this.roomid, parsed?.user);
		return this;
	}
	modlog(entry: ModlogEntry, overrideID?: string) {
		void Rooms.Modlog.write(this.roomid, entry, overrideID);
	}
	rename(newID: RoomID) {
		const result = this.statements.roomlogExists.run(newID);
		if (result) return false;
		this.statements.rename.run(newID, this.roomid);
		roomlogs.delete(this.roomid);
		this.roomid = newID;
		roomlogs.set(newID, this);
		return this;
	}
	truncate() {
		if (this.noAutoTruncate) return;
		if (this.log.length > 100) {
			this.log.splice(0, this.log.length - 100);
		}
	}

	destroy(destroyModlog?: boolean) {
		const promises = [];

		if (destroyModlog) promises.push(Rooms.Modlog.destroy(this.roomid));
		Roomlogs.roomlogs.delete(this.roomid);
		return Promise.all(promises);
	}
}

const roomlogs = new Map<string, Roomlog>();

function createRoomlog(room: BasicRoom, options = {}) {
	let roomlog = Roomlogs.roomlogs.get(room.roomid);
	if (roomlog) throw new Error(`Roomlog ${room.roomid} already exists`);

	roomlog = new Roomlog(room, options);
	Roomlogs.roomlogs.set(room.roomid, roomlog);
	return roomlog;
}

export const Roomlogs = {
	create: createRoomlog,
	Roomlog,
	roomlogs,
};
