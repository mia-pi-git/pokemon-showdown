import * as Sqlite from 'better-sqlite3';

/** This is a `Map<receiver, Map<sender, messages[]>>` */
export const PrivateMessages = new class extends Map<string, Map<string, string[]>>{
	database: Sqlite.Database;
	constructor() {
		super();
		this.database = new Sqlite('./databases/offline-pms.db');
		this.load();
	}
	send(message: string, user: User, pmTarget: User, onlyRecipient: User | null = null) {
		const buf = `|pm|${user.getIdentity()}|${pmTarget.getIdentity()}|${message}`;
		if (onlyRecipient) return onlyRecipient.send(buf);
		user.send(buf);
		if (pmTarget !== user) pmTarget.send(buf);
		pmTarget.lastPM = user.id;
		user.lastPM = pmTarget.id;
	}
	sendOffline(message: string, user: User | string, pmTarget: ID) {
		// support pms from a fake user
		const userid = typeof user === 'string' ? toID(user) : user.id;
		const timestamp = Date.now();

		const receivedPMs = this.get(pmTarget);
		const pending = receivedPMs.get(userid);
		if (!pending) {
			receivedPMs.set(userid, [message]);
		} else {
			const limit = typeof user === 'object' && user.trusted ? 15 : 5;
			if (pending.length > limit) {
				throw new Chat.ErrorMessage(`You cannot send more than ${limit} offline PMs to a user at a time.`);
			}
			pending.push(message);
		}
		this.database.prepare(
			`INSERT INTO offline_pms (sender, receiver, message, timestamp) VALUES (?, ?, ?, ?)`
		).run(userid, toID(pmTarget), message, timestamp);
	}
	delete(user: string) {
		user = toID(user);
		if (!this.has(user)) return false;
 		this.database.prepare(`DELETE FROM offline_pms WHERE receiver = ?`).run(user);
		super.delete(user);
		return true;
	}
	get(user: User | string) {
		const userid = typeof user === 'string' ? user.toLowerCase().replace(/[^a-z0-9]+/g, '') : user.id;
		// yes, this has to be a super call, crashes otherwise
		const cachedPMs = super.get(userid);
		if (cachedPMs) return cachedPMs;
		const pmMap: Map<string, string[]> = new Map();
	 	this.set(userid, pmMap);
		return pmMap;
	}
	sendSaved(user: User) {
		const pms = this.get(user);
		if (!pms) return;
 		for (const [userid, pmBuffer] of pms) {
			if (!this.canReceive(user, userid)) continue;
			for (const line of pmBuffer) {
				user.send(`|pm|${this.getOfflineIdentity(userid as ID)}|${user.getIdentity()}|${line} __(Sent while you were offline)__`);
			}
		}
		return this.delete(user.id);
	}
	getOfflineIdentity(id: ID) {
		const user = Users.get(id);
		if (user) return user.getIdentity();
		const name = Users.globalAuth.usernames.get(id);
		return `${Users.globalAuth.get(id)}${name ? name : id}`;
	}
	load() {
		// from db to map, on init
		const rawResults = this.database.prepare(`SELECT * FROM offline_pms ORDER BY timestamp DESC`).all();
		for (const entry of rawResults) {
			const {sender, receiver, message} = entry;
			const pending = this.get(receiver);
			if (!pending.get(sender)) {
				pending.set(sender, []);
			} else {
				pending.get(sender)?.push(message);
			}
		}
		return this;
	}
	undoPM(sender: string, receiver: string, count = 1) {
		sender = toID(sender);
		receiver = toID(receiver);
		const targetPMs = this.get(receiver);
		const sentPMs = targetPMs.get(sender);
		if (!sentPMs || !sentPMs.length) {
			throw new Chat.ErrorMessage(`You have no offline PMs pending for '${receiver}'.`);
		}
		this.database.prepare(
			`DELETE FROM offline_pms WHERE message IN (
				 SELECT message FROM offline_pms
				 WHERE sender = ? AND receiver = ?
				 ORDER BY timestamp DESC
				 LIMIT ?
			)`
	  ).run(sender, receiver, count);
		while (count > 0) {
			sentPMs.pop();
			count--;
		}
		return true;
	}
	canReceive(receiver: User, sender: string) {
		const blocked = receiver.settings.blockPMs as boolean | GroupSymbol;
		if (!blocked) return true;
		const senderRank = Users.globalAuth.get(toID(sender));
		if (blocked === true) {
			return Users.Auth.atLeast(senderRank, '%');
		} else if (Config.groupsranking.includes(blocked)) {
			return Users.Auth.atLeast(senderRank, blocked);
		} else {
			return true;
		}
	}
}
