import * as Sqlite from 'better-sqlite3';
import {FS} from '../../lib/fs';
import {Utils} from '../../lib/utils';

const database = new Sqlite(`${__dirname}/../../databases/roomlogs.db`);
function getUser(line: string) {
	const messageStart = line.split('|')[1] === `c:` ? '|c:|' : '|c|';
	const section = !this.noLogTimes ? 4 : 3; // ['', 'c' timestamp?, author, message]
	if (line.startsWith(messageStart)) {
		const parts = Utils.splitFirst(line, '|', section);
		return parts[section - 1];
	}
}

function validDirectories(path: string) {
	return FS(path).readdirSync().filter(item => FS(`${path}/${item}`).isDirectorySync());
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

class RoomlogConverter {
	roomid: string;
	statement: Sqlite.Statement;
	constructor(roomid: string) {
		this.roomid = roomid;
		this.statement = database.prepare(`INSERT INTO roomlogs (line, timestamp, room, user) VALUES(?, ?, ?, ?)`);
	}
	async getMonths() {
		const files = await FS(`logs/chat/${this.roomid}`).readdir();
		return files.filter(file => /^[0-9][0-9][0-9][0-9]-[0-9][0-9]$/.test(file));
	}
	async run() {
		console.log(`Converting logs for ${this.roomid}.`);
		const months = await this.getMonths();
		for (const month of months) {
			await this.convertMonth(month);
		}
	}
	async convertMonth(month: string) {
		let dayFiles = await FS(`logs/chat/${this.roomid}/${month}`).readdir();
		dayFiles = dayFiles.filter(file => /^[0-9][0-9][0-9][0-9]-[0-9][0-9]$/.test(file));
		console.log(`Now converting roomlogs for ${this.roomid} on month ${month}.`);
		for (const file of dayFiles) {
			console.log(`Converting ${file}`);
			const stream = FS(`logs/chat/${this.roomid}/${month}/${file}`).createReadStream();
			for await (const line of stream.byLine()) {
				const day = file.slice(0, -4);
				const date = new Date(`${day} ${line.split(' ')[0]}`).getTime();
				this.insert(date, line, getUser(line));
			}
		}
		return true;
	}
	insert(date: number, message: string, user?: string) {
		this.statement.run(message, date, this.roomid, user);
	}
}

export async function start(opts?: string[]) {
	const args = opts ? opts : process.argv.slice(2).map(toID);
	if (args.includes('all')) {
		const files = validDirectories('logs/chat');
		for (const roomid of files) {
			await (new RoomlogConverter(roomid)).run();
		}
	} else {
		for (const arg of args) {
			const path = FS(`logs/chat/${arg}`);
			if (!path.existsSync) {
				console.error(`Room ${arg} does not have logs`);
				return;
			}
			const files = await path.readdir();
			for (const roomid of files) {
				await (new RoomlogConverter(roomid)).run();
			}
		}
	}

}

void start();
