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
import * as sqlite from 'sqlite';

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
	broadcastBuffer: string;
	/**
	 * undefined = uninitialized,
	 * null = disabled
	 */
	modlogStream?: Streams.WriteStream | null;
	/**
	 * undefined = uninitialized,
	 * null = disabled
	 */
	roomlogStream?: Streams.WriteStream | null;
	sharedModlog: boolean;
	roomlogFilename: string;
	database?: sqlite.Database;
	databaseUpdates?: Promise<sqlite.Statement | sqlite.Database>[];
	constructor(room: BasicRoom, options: RoomlogOptions = {}) {
		this.roomid = room.roomid;

		this.isMultichannel = !!options.isMultichannel;
		this.noAutoTruncate = !!options.noAutoTruncate;
		this.noLogTimes = !!options.noLogTimes;

		this.log = [];
		this.broadcastBuffer = '';

		this.modlogStream = undefined;
		this.roomlogStream = undefined;

		// modlog/roomlog state
		this.sharedModlog = false;

		this.roomlogFilename = '';

		void this.initStorage();
	}
	async initStorage() {
		if (Config.storage?.logs === 'sqlite') {
			this.database = await sqlite.open('./sqlite.db').then(database => {
				const room = Rooms.get(this.roomid)!;
				return database.exec(
					`CREATE TABLE IF NOT EXISTS roomlogs_${this.roomid}
					(log STRING NOT NULL, day INTEGER, month INTEGER, year INTEGER, timestamp INTEGER)`
				);
			});
			this.databaseUpdates = [];
		} else {
			this.setupModlogStream();
			void this.setupRoomlogStream(true);
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
	setupModlogStream() {
		if (this.modlogStream !== undefined) return;
		if (!this.roomid.includes('-')) {
			this.modlogStream = FS(`logs/modlog/modlog_${this.roomid}.txt`).createAppendStream();
			return;
		}
		const sharedStreamId = this.roomid.split('-')[0];
		let stream = Roomlogs.sharedModlogs.get(sharedStreamId);
		if (!stream) {
			stream = FS(`logs/modlog/modlog_${sharedStreamId}.txt`).createAppendStream();
			Roomlogs.sharedModlogs.set(sharedStreamId, stream);
		}
		this.modlogStream = stream;
		this.sharedModlog = true;
	}
	async setupRoomlogStream(sync = false) {
		if (this.roomlogStream === null) return;
		if (!Config.logchat) {
			this.roomlogStream = null;
			return;
		}
		if (this.roomid.startsWith('battle-')) {
			this.roomlogStream = null;
			return;
		}
		const date = new Date();
		const dateString = Chat.toTimestamp(date).split(' ')[0];
		const monthString = dateString.split('-', 2).join('-');
		const basepath = `logs/chat/${this.roomid}/`;
		const relpath = `${monthString}/${dateString}.txt`;

		if (relpath === this.roomlogFilename) return;

		if (sync) {
			FS(basepath + monthString).mkdirpSync();
		} else {
			await FS(basepath + monthString).mkdirp();
			if (this.roomlogStream === null) return;
		}
		this.roomlogFilename = relpath;
		if (this.roomlogStream) void this.roomlogStream.writeEnd();
		this.roomlogStream = FS(basepath + relpath).createAppendStream();
		// Create a symlink to today's lobby log.
		// These operations need to be synchronous, but it's okay
		// because this code is only executed once every 24 hours.
		const link0 = basepath + 'today.txt.0';
		FS(link0).unlinkIfExistsSync();
		try {
			FS(link0).symlinkToSync(relpath); // intentionally a relative link
			FS(link0).renameSync(basepath + 'today.txt');
		} catch (e) {} // OS might not support symlinks or atomic rename
		if (!Roomlogs.rollLogTimer) void Roomlogs.rollLogs();
	}
	add(message: string) {
		this.roomlog(message);
		message = this.withTimestamp(message);
		this.log.push(message);
		this.broadcastBuffer += message + '\n';
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
		this.broadcastBuffer += fullMessage + '\n';
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
		this.broadcastBuffer += fullMessage + '\n';
	}
	private parseChatLine(line: string) {
		const messageStart = !this.noLogTimes ? '|c:|' : '|c|';
		const section = !this.noLogTimes ? 4 : 3; // ['', 'c' timestamp?, author, message]
		if (line.startsWith(messageStart)) {
			const parts = Utils.splitFirst(line, '|', section);
			return {user: parts[section - 1], message: parts[section]};
		}
	}
	async roomlog(message: string, date = new Date()) {
		const useSql = Config.storage?.logs === 'sqlite';
		const timestamp = Chat.toTimestamp(date).split(' ')[1] + ' ';
		const [year, month, day] = Chat.toTimestamp(new Date()).split(' ')[0].split('-');
		message = message.replace(/<img[^>]* src="data:image\/png;base64,[^">]+"[^>]*>/g, '');
		if (useSql) {
			const db = this.database;
			if (!db) return;
			// escape so that sql doesn't crash on the " symbols
			message = message.replace(/"/g, `""`);
			const promise = db.exec(
				`INSERT INTO roomlogs_${this.roomid} VALUES("${timestamp + message}", "${day}", "${month}", "${year}", "${Date.now()}")`
			);
			this.databaseUpdates?.push(promise);
			return Promise.all(this.databaseUpdates!);
		} else {
			if (!this.roomlogStream) return;
			void this.roomlogStream.write(timestamp + message + '\n');
		}
	}
	modlog(message: string) {
		if (!this.modlogStream) return;
		void this.modlogStream.write('[' + (new Date().toJSON()) + '] ' + message + '\n');
	}
	async rename(newID: RoomID): Promise<true> {
		const modlogPath = `logs/modlog`;
		const roomlogPath = `logs/chat`;
		const modlogStreamExisted = this.modlogStream !== null;
		const roomlogStreamExisted = this.roomlogStream !== null;
		const useSql = Config.storage?.logs === 'sqlite';
		await this.destroy();
		const checkTable = async (ID?: string) => {
			const db = this.database;
			if (!db) throw new Error("SQLite log database does not exist.");
			try {
				await db.exec(`SELECT * FROM roomlogs_${ID ? ID : this.roomid}`);
			} catch (e) {
				return false;
			}
			return true;
		};
		const renameTable = () => {
			const db = this.database;
			if (!db) throw new Error("SQLite log database does not exist.");
			return db.exec(`ALTER TABLE roomlogs_${this.roomid} RENAME TO roomlogs_${newID}`);
		};
		await Promise.all([
			FS(modlogPath + `/modlog_${this.roomid}.txt`).exists(),
			useSql ? checkTable() : FS(roomlogPath + `/${this.roomid}`).exists(),
			FS(modlogPath + `/modlog_${newID}.txt`).exists(),
			useSql ? checkTable(newID) : FS(roomlogPath + `/${newID}`).exists(),
		]).then(([modlogExists, roomlogExists, newModlogExists, newRoomlogExists]) => {
			return Promise.all([
				modlogExists && !newModlogExists ?
					FS(modlogPath + `/modlog_${this.roomid}.txt`).rename(modlogPath + `/modlog_${newID}.txt`) :
					undefined,
				roomlogExists && !newRoomlogExists ?
					useSql ? renameTable() : FS(roomlogPath + `/${this.roomid}`).rename(roomlogPath + `/${newID}`) :
					undefined,
			]);
		});
		this.roomid = newID;
		Roomlogs.roomlogs.set(newID, this);
		if (Config.storage?.logs !== 'sqlite') {
			if (modlogStreamExisted) {
				// set modlogStream to undefined (uninitialized) instead of null (disabled)
				this.modlogStream = undefined;
				this.setupModlogStream();
			}
			if (roomlogStreamExisted) {
				this.roomlogStream = undefined;
				this.roomlogFilename = "";
				await this.setupRoomlogStream(true);
			}
		}
		return true;
	}
	static async rollLogs() {
		if (Roomlogs.rollLogTimer === true) return;
		if (Roomlogs.rollLogTimer) {
			clearTimeout(Roomlogs.rollLogTimer);
		}
		Roomlogs.rollLogTimer = true;
		for (const log of Roomlogs.roomlogs.values()) {
			await log.setupRoomlogStream();
		}
		const time = Date.now();
		const nextMidnight = new Date(time + 24 * 60 * 60 * 1000);
		nextMidnight.setHours(0, 0, 1);
		Roomlogs.rollLogTimer = setTimeout(() => void Roomlog.rollLogs(), nextMidnight.getTime() - time);
	}
	truncate() {
		if (this.noAutoTruncate) return;
		if (this.log.length > 100) {
			this.log.splice(0, this.log.length - 100);
		}
	}

	destroy() {
		const promises = [];
		if (Config.storage?.logs !== 'sqlite') {
			if (this.sharedModlog) {
				this.modlogStream = null;
			}
			if (this.modlogStream) {
				promises.push(this.modlogStream.writeEnd());
				this.modlogStream = null;
			}
			if (this.roomlogStream) {
				promises.push(this.roomlogStream.writeEnd());
				this.roomlogStream = null;
			}
		}
		Roomlogs.roomlogs.delete(this.roomid);
		return Promise.all(promises);
	}
}

const sharedModlogs = new Map<string, Streams.WriteStream>();

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
	sharedModlogs,

	rollLogs: Roomlog.rollLogs,

	rollLogTimer: null as NodeJS.Timeout | true | null,
};
