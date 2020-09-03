/**
 * Roomlogs
 * Pokemon Showdown - http://pokemonshowdown.com/
 *
 * This handles data storage for rooms.
 *
 * @license MIT
 */

import {Utils} from '../lib/utils';
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
	roomid: RoomID;
	/**
	 * Scrollback log
	 */
	log: string[];
	broadcastBuffer: string[];
	database: Sqlite.Database;
	constructor(room: BasicRoom, options: RoomlogOptions = {}) {
		this.roomid = room.roomid;

		this.isMultichannel = !!options.isMultichannel;
		this.noAutoTruncate = !!options.noAutoTruncate;
		this.noLogTimes = !!options.noLogTimes;

		this.log = [];
		this.broadcastBuffer = [];

		this.database = new Sqlite(`${__dirname}/../databases/roomlogs.db`);
		Rooms.Modlog.initialize(this.roomid);
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
	private withTimestamp(message: string) {
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
	private parseChatLine(line: string) {
		line = this.withTimestamp(line);
		const messageStart = !this.noLogTimes ? '|c:|' : '|c|';
		const section = !this.noLogTimes ? 4 : 3; // ['', 'c' timestamp?, author, message]
		if (line.startsWith(messageStart)) {
			const parts = Utils.splitFirst(line, '|', section);
			return {user: parts[section - 1], message: parts[section]};
		}
	}
	roomlog(message: string, date: Date | number = new Date()) {
		message = message.replace(/<img[^>]* src="data:image\/png;base64,[^">]+"[^>]*>/g, '');
		const parsed = this.parseChatLine(message);
		const timestamp = Chat.toTimestamp(new Date(date)).split(' ')[1] + ' ';
		const stamp = new Date(date).getTime();
		// user might not exist, user might also be ~, which should default to staff if that happens
		const user = parsed ? toID(parsed.user) ? toID(parsed.user) : 'staff' : null;
		this.database.prepare(
			`INSERT INTO roomlogs (room, line, timestamp, userid) VALUES(?, ?, ?, ?)`
		).run(this.roomid, timestamp + message, stamp, user);
		return this;
	}
	modlog(message: string, overrideID?: string) {
		void Rooms.Modlog.write(this.roomid, message, overrideID);
	}
	async rename(newID: RoomID): Promise<true> {
		await this.destroy(false); // don't destroy modlog, since it's renamed later
		// update table here
		this.database.prepare(
			`UPDATE roomlogs
			SET room = ?
			WHERE room = ?`
		).run(newID, this.roomid);
		await Rooms.Modlog.rename(this.roomid, newID);
		this.roomid = newID;
		Roomlogs.roomlogs.set(newID, this);
		return true;
	}
	truncate() {
		if (this.noAutoTruncate) return;
		if (this.log.length > 100) {
			this.log.splice(0, this.log.length - 100);
		}
	}

	destroy(destroyModlog?: boolean) {
		// TODO lock db

		Roomlogs.roomlogs.delete(this.roomid);
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
