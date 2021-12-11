/**
 * Roomlogs
 * Pokemon Showdown - http://pokemonshowdown.com/
 *
 * This handles data storage for rooms.
 *
 * @license MIT
 */

import {FS, Utils, PGTable} from '../lib';
import {SQL} from 'sql-template-strings';
import common from './common';
import type {PartialModlogEntry} from './modlog';

interface RoomlogOptions {
	isMultichannel?: boolean;
	noAutoTruncate?: boolean;
	noLogTimes?: boolean;
}

export class Scrollback {
	room: BasicRoom;
	gettingLog: Promise<string[]> | null = null;
	logsWhileGetting: string[] | null = null;
	constructor(room: BasicRoom) {
		this.room = room;
	}
	async add(message: string) {
		await common.redis.lpush(`scrollback:${this.room.roomid}`, message);
	}
	private getLength() {
		return common.redis.llen(`scrollback:${this.room.roomid}`);
	}
	async truncate() {
		const start = await this.getLength();
		if (start < 100) return 0;
		await common.redis.ltrim(`scrollback:${this.room.roomid}`, 0, 99);
		return start - await this.getLength();
	}
	async get() {
		if (this.gettingLog) return this.gettingLog;
		this.logsWhileGetting = [];
		this.gettingLog = (async () => {
			const fetched = await common.redis.lrange(`scrollback:${this.room.roomid}`, 0, 99);
			const logs = fetched.reverse().concat(this.logsWhileGetting || []);
			this.gettingLog = this.logsWhileGetting = null;
			return logs;
		})();
		return this.gettingLog;
	}
	async destroy() {
		await this.clear();
	}
	async clear() {
		await common.redis.del(`scrollback:${this.room.roomid}`);
	}
	async modify(
		cb: (log: string, index: number) => boolean | string | void | undefined,
		desc = false
	) {
		const logs = await this.get();
		if (desc) logs.reverse();
		const modified = [];
		for (const [i, log] of logs.entries()) {
			const redisIdx = i + 1;
			// wants us to return cb(log[i], i) but. no.
			// eslint-disable-next-line callback-return
			const result = cb(log, i);
			if (result === false) {
				await common.redis.lrem(`scrollback:${this.room.roomid}`, 1, log);
				modified.push(i);
			} else if (typeof result === 'string') {
				logs[i] = result;
				await common.redis.lset(`scrollback:${this.room.roomid}`, redisIdx, result);
				modified.push(i);
			}
		}
		return modified;
	}
}
export const logs = new PGTable<{
	id: number,
	roomid: RoomID,
	message: string,
	date: Date,
}>('logs', 'id', common.pool);

/**
 * Most rooms have three logs:
 * - scrollback
 * - roomlog
 * - modlog
 * This class keeps track of all three.
 *
 * The scrollback is stored in Redis (if enabled, else memory), and is the log you get when you
 * join the room. It does not get moderator messages.
 *
 * The modlog is stored in
 * `logs/modlog/modlog_<ROOMID>.txt`
 * It contains moderator messages, formatted for ease of search.
 * Direct modlog access is handled in server/modlog/; this file is just
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
	scrollback: Scrollback;
	logLength = 0;
	visibleMessageCount = 0;
	broadcastBuffer: string[];

	numTruncatedLines: number;
	constructor(room: BasicRoom, options: RoomlogOptions = {}) {
		this.roomid = room.roomid;

		this.isMultichannel = !!options.isMultichannel;
		this.noAutoTruncate = !!options.noAutoTruncate;
		this.noLogTimes = !!options.noLogTimes;

		this.broadcastBuffer = [];
		this.numTruncatedLines = 0;
		this.scrollback = new Scrollback(room);

	}
	/**
	 * Returns full, unsanitized, untransformed scrollback.
	 * If you want something to show to users, use getScrollback.
	 */
	get() {
		return this.scrollback.get();
	}
	async getScrollback(channel = 0) {
		let log = await this.get();
		if (!this.noLogTimes) log = [`|:|${~~(Date.now() / 1000)}`].concat(log);
		if (!this.isMultichannel) {
			return log.join('\n') + '\n';
		}
		const sanitized = [];
		for (let i = 0; i < log.length; ++i) {
			const line = log[i];
			const split = /\|split\|p(\d)/g.exec(line);
			if (split) {
				const canSeePrivileged = (channel === Number(split[0]) || channel === -1);
				const ownLine = log[i + (canSeePrivileged ? 1 : 2)];
				if (ownLine) sanitized.push(ownLine);
				i += 2;
			} else {
				sanitized.push(line);
			}
		}
		return sanitized.join('\n') + '\n';
	}
	private setup = false;
	async setupDB() {
		if (!Config.logchat || this.setup) {
			return;
		}
		try {
			await logs.selectOne('*');
		} catch {
			await logs.query(SQL(FS(`databases/schemas/logs.sql`).readSync()));
		}
		this.setup = true;
	}
	add(message: string) {
		this.roomlog(message);
		// |uhtml gets both uhtml and uhtmlchange
		// which are visible and so should be counted
		if (['|c|', '|c:|', '|raw|', '|html|', '|uhtml'].some(k => message.startsWith(k))) {
			this.visibleMessageCount++;
		}
		message = this.withTimestamp(message);
		void Promise.resolve(this.scrollback.add(message)).then(() => this.logLength++);
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
	async hasUsername(username: string) {
		const userid = toID(username);
		for (const line of await this.get()) {
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
	async truncate() {
		const count = await this.scrollback.truncate();
		this.logLength -= count;
		this.numTruncatedLines += count;
	}
	async clearText(userids: ID[], lineCount = 0) {
		const cleared: ID[] = [];
		const clearAll = (lineCount === 0);
		await this.scrollback.modify((line) => {
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
		}, true);
		return cleared;
	}
	async uhtmlchange(name: string, message: string) {
		const originalStart = '|uhtml|' + name + '|';
		const fullMessage = originalStart + message;
		await this.scrollback.modify(line => {
			if (line.startsWith(originalStart)) {
				return fullMessage;
			}
		});
		this.broadcastBuffer.push(fullMessage);
	}
	async attributedUhtmlchange(user: User, name: string, message: string) {
		const start = `/uhtmlchange ${name},`;
		const fullMessage = this.withTimestamp(`|c|${user.getIdentity()}|${start}${message}`);
		await this.scrollback.modify(line => {
			if (this.parseChatLine(line)?.message.startsWith(start)) {
				return fullMessage;
			}
		});
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
		if (!Config.logchat) return;
		message = message.replace(/<img[^>]* src="data:image\/png;base64,[^">]+"[^>]*>/g, '');
		const log = {
			roomid: this.roomid,
			message,
			date: date || new Date(),
		};
		void this.setupDB().then(() => void logs.insert(log));
	}
	modlog(entry: PartialModlogEntry, overrideID?: string) {
		void Rooms.Modlog.write(this.roomid, entry, overrideID);
	}
	async rename(newID: RoomID): Promise<true> {
		await Rooms.Modlog.rename(this.roomid, newID);
		this.roomid = newID;
		await logs.updateAll({roomid: newID}, SQL`roomid = ${newID}`);
		return true;
	}
	/**
	 * Returns the total number of lines in the roomlog, including truncated lines.
	 */
	getLineCount(onlyVisible = true) {
		return (onlyVisible ? this.visibleMessageCount : this.logLength) + this.numTruncatedLines;
	}

	destroy() {
		Roomlogs.roomlogs.delete(this.roomid);
		return this.scrollback.destroy();
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
