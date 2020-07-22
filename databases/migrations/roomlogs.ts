import {load} from '../../server/config-loader';
import {Monitor} from '../../server/monitor';
// @ts-ignore
global.Config = load();
// @ts-ignore
global.Monitor = Monitor;
import {FS} from '../../lib/fs';
import {Rooms} from '../../server/rooms';
import {LogReaderRoom} from '../../server/chat-plugins/chatlog';
import * as sqlite from 'sqlite';

exports.SQLiteConverter = new class {
	exists(roomid: string, day: string) {
		return FS(`logs/chat/${roomid}/${day.slice(0, -3)}/${day}.txt`).existsSync();
	}
	escape(line: string) {
		return line.replace(/"/g, '$&$&');
	}
	async convertDay(roomid: string, day: string) {
		if (!day) throw new Error('no day passed to convertDay.');
		if (!roomid) throw new Error('no roomid passed to convertDay.');
		console.log(`Converting logs for ${day} on ${roomid}.`);
		if (!this.exists(roomid, day)) return [];
		const [y, m, d] = day.split('-');
		const database = await sqlite.open('./sqlite.db');
		await database.exec(
			`CREATE TABLE IF NOT EXISTS roomlogs_${roomid} (log STRING NOT NULL, day INTEGER, month INTEGER, year INTEGER, timestamp INTERGET)`
		);
		try {
			const lines = FS(`logs/chat/${roomid}/${y}-${m}/${y}-${m}-${d}.txt`).readSync().split('\n');
			for (const line of lines) {
				await database.exec(
					`INSERT INTO roomlogs_${roomid} VALUES("${this.escape(line)}", "${d}", "${m}", "${y}", "${Date.now()}")`
				);
			}
		} catch (e) {
			throw e;
		}
		return true;
	}

	async convertMonth(roomid: string, month: string) {
		if (!month) throw new Error('no month passed to convertMonth.');
		if (!roomid) throw new Error('no roomid passed to convertMonth.');
		console.log(`Converting logs for ${month} on ${roomid}`);
		const days = await new LogReaderRoom(roomid).listDays(month);
		for (const day of days) {
			try {
				this.convertDay(roomid, day);
			} catch (e) {
				throw e;
			}
		}
		return true;
	}

	async convertRoom(roomid: string) {
		console.log(`Converting logs for ${roomid}.`);
		const months = await new LogReaderRoom(roomid).listMonths();
		for (const month of months) {
			try {
				await this.convertMonth(roomid, month);
			} catch (e) {
				throw e;
			}
		}
		return true;
	}
	/**
	 * NOT RECOMMENDED FOR BIG SERVERS.
	 * NOT.
	 * RECOMMENDED.
	 * SERIOUSLY.
	 */
	async convert() {
		console.log(`Converting all room logs to SQLite.`);
		const promises = [];
		for (const room of Rooms.rooms.values()) {
			promises.push(this.convertRoom(room.roomid));
		}
		await Promise.all(promises).catch(e => {
			console.log(e);
		});
		console.log(`Finished conversion.`);
	}
}

function parseFlags() {
	if (!process.argv.includes(__filename)) return;
	const flags = process.argv.slice(2);
	const actions = [];
	console.log(flags);
	let room = 'lobby';
	for (const arg of flags.map(item => item.trim())) {
		const converter = exports.SQLiteConverter;
		switch (arg) {
			case '--room':
				room = flags.slice(1).shift().trim();
				actions.push(converter.convertRoom(room));
				break;
			case '--day':
				actions.push(converter.convertDay(room, flags.slice(1).shift().trim()));
				break;
			case '--month':
				actions.push(converter.convertMonth(room, arg.slice('--date'.length).trim()));
				break;
			case 'h':
			case '--help':
			case '':
				const help = [
					'--to: specify a type to convert logs to. Must be used first.',
					'--room: specify a room to convert (default: all - NOT RECOMMENDED.)',
					'--date: specify a date to convert - in months.',
				]
				console.log(help.join('\n'));
				break;
		}
	}
	return Promise.all(actions).then(() => {
		actions.length > 0 ? console.log(`Actions complete.`) : undefined;
	});
}

parseFlags();
