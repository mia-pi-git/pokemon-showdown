import {FS} from '../../lib/fs';
import * as sqlite from 'sqlite';
import {Rooms} from '../../server/rooms';

export const SQLiteConverter = new class {
	exists(roomid: string, day: string) {
		return FS(`logs/chat/${roomid}/${day.slice(0, -3)}/${day}.txt`).existsSync();
	}
	parseDay(day: string) {
		return day.split('-');
	}

	async convertDay(roomid: string, day: string) {
		console.log(`Converting logs for ${day} on ${roomid}.`);
		if (!this.exists(roomid, day)) return [];
		const [y, m, d] = this.parseDay(day);
		const stream = FS(`logs/chat/${roomid}/${m}/${day}.txt`).createReadStream();
		let line;
		const promises = [];
		const database = await sqlite.open('../../sqlite.db');
		while ((line = await stream.readLine() !== null)) {
			const promise = database.run(`INSERT INTO roomlogs_${roomid} VALUES($log, $day, $month, $year, $timestamp)`, {
				'$log': line,
				'$year': y,
				'$month': m,
				'$day': d,
				'$timestamp': line.split(' ')[0],
			});
			promises.push(promise);
		}
		return Promise.all(promises);
	}

	async convertMonth(roomid: string, month: string) {
		console.log(`Converting logs for ${month} on ${roomid}`);
		const days = FS(`logs/chat/${roomid}/${month}`).readdirSync().map(item => item.slice(0, -3));
		const promises = [];
		for (const day of days) {
			promises.push(this.convertDay(roomid, day));
		}
		return Promise.all(promises);
	}

	async convertRoom(roomid: string) {
		console.log(`Converting logs for ${roomid}.`);
		const months = FS(`logs/chat/${roomid}`).readdirSync();
		const promises = [];
		for (const month of months) {
			promises.push(this.convertMonth(roomid, month));
		}
		return Promise.all(promises);
	}
	/**
	 * NOT RECOMMENDED FOR BIG SERVERS
	 */
	async convert() {
		console.log(`Converting all room logs to SQLite.`);
		const promises = [];
		for (const room of Rooms.rooms.values()) {
			promises.push(this.convertRoom(room.roomid));
		}
		await Promise.all(promises);
		console.log(`Finished conversion.`);
	}
}

export const TextConverter = new class {
	convert() {
		const promises = [];
		for (const room of Rooms.rooms.values()) {
			promises.push(this.convertRoom(room.roomid));
		}
		return Promise.all(promises);
	}
	async convertRoom(roomid: string) {
		console.log(`Converting logs for ${roomid} to text.`);
		const promises = [];
		const database = await sqlite.open('../../sqlite.db');
		const result = await database.all(`SELECT * FROM roomlogs_${roomid}`);
		for (const item of result) {
			promises.push(this.insertLine(item.log, roomid, item.day, item.month, item.year));
		}
		return Promise.all(promises);
	}
	insertLine(line: string, roomid: string, day: string, month: string, year: string) {
		const stream = FS(`logs/chat/${roomid}/${year}-${month}/${year}-${month}-${day}.txt`).createAppendStream();
		void stream.writeLine(line);
	}
}
