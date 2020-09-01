import {FS} from '../../lib/fs';
import {Utils} from '../../lib/utils';
import * as Sqlite from 'better-sqlite3';

const ROOMFAQ_FILE = 'config/chat-plugins/faqs.json';
const MAX_ROOMFAQ_LENGTH = 8192;

export const roomFaqs: Map<string, Map<string, FaqEntry>> = new Map();
export const faqAliases: Map<string, Map<string, string>> = new Map();

interface FaqEntry {
	content: string;
	aliases: string[];
	name: string;
	room: string;
}

function loadFaqs() {
	if (FS(ROOMFAQ_FILE).existsSync()) {
		return convertJSON();
	}
	const database = new Sqlite(`${__dirname}/../../databases/chat-plugins.db`);
	const rawData = database.prepare(`SELECT * FROM room_faqs`).all();
	for (const faq of rawData) {
		const {name, aliases, room} = faq;
		const roomAliases = getAliasesByRoom(room);
		const faqs = getRoomFaqs(room);
		for (const alias of (aliases || '').split(',').filter(Boolean)) {
			roomAliases.set(alias, name);
		}
		faqs.set(name, faq);
	}
}

function saveRoomFaqs() {
	const database = new Sqlite(`${__dirname}/../../databases/chat-plugins.db`);
	for (const faqMap of roomFaqs.values()) {
		for (const entry of faqMap.values()) {
			const {content, name, room} = entry;
			const aliases = getFaqAliases(room, name);
			database.prepare(
				`REPLACE INTO room_faqs (name, content, aliases, room) VALUES (?, ?, ?, ?)`
			).run(name, content, aliases.join(','), room);
		}
	}
}

function convertJSON() {
	const JSONPath = FS(ROOMFAQ_FILE);
	const faqData = JSON.parse(JSONPath.readIfExistsSync() || "{}");
	JSONPath.unlinkIfExistsSync();
	for (const room in faqData) {
		const roomEntries: {[k: string]: string} = faqData[room];
		const roomAliases = getAliasesByRoom(room);
		const faqs = getRoomFaqs(room);
		for (const key in roomEntries) {
			const entry = roomEntries[key];
			if (entry.startsWith('>')) {
				// this entry is an alias, set it into the map and continue the loop
				roomAliases.set(key, entry.slice(1));
				continue;
			}
			// find all the aliases so that they can be set into the entry object (which is used for loading from SQLite)
			const aliases = Object.keys(roomEntries).filter(item => {
				return roomEntries[item].startsWith('>') && roomEntries[item].slice(1) === key;
			});
			const newEntry = {
				content: entry,
				name: key,
				room: room,
				aliases: aliases,
			};
			faqs.set(key, newEntry);
		}
	}
	saveRoomFaqs();
}

function getFaqAliases(room: RoomID | string, name: string) {
	const faqs = getAliasesByRoom(room);
	const buffer: string[] = [];
	for (const [alias, faq] of faqs) {
		if (faq === toID(name)) buffer.push(alias);
	}
	return buffer.filter(Boolean);
}

export function getRoomFaqs(room: string) {
	const roomMap = roomFaqs.get(room);
	if (roomMap) return roomMap;
	const faqMap: Map<string, FaqEntry> = new Map();
	roomFaqs.set(room, faqMap);
	return faqMap;
}

export function getAliasesByRoom(room: string) {
	const aliasMap = faqAliases.get(room);
	if (aliasMap) return aliasMap;
	const aliases: Map<string, string> = new Map();
	faqAliases.set(room, aliases);
	return aliases;
}

export function getFaq(room: string, topic: string): FaqEntry | undefined {
	topic = toID(topic);
	const faqs = getRoomFaqs(room);
	const faq = faqs.get(topic);
	if (faq) return faq;
	const roomAliases = getAliasesByRoom(room);
	const aliasedFaq = roomAliases.get(topic);
	if (!aliasedFaq) return;
	return faqs.get(aliasedFaq);
}

loadFaqs();

export const commands: ChatCommands = {
	addfaq(target, room, user, connection) {
		if (!room) return this.requiresRoom();
		if (!this.can('ban', null, room)) return false;
		if (!room.persist) return this.errorReply("This command is unavailable in temporary rooms.");
		if (!target) return this.parse('/help roomfaq');

		target = target.trim();
		const input = this.filter(target);
		if (target !== input) return this.errorReply("You are not allowed to use fitered words in roomfaq entries.");
		let [topic, ...rest] = input.split(',');

		topic = toID(topic);
		if (!(topic && rest.length)) return this.parse('/help roomfaq');
		let text = rest.join(',').trim();
		if (topic.length > 25) return this.errorReply("FAQ topics should not exceed 25 characters.");
		if (Chat.stripFormatting(text).length > MAX_ROOMFAQ_LENGTH) {
			return this.errorReply(`FAQ entries should not exceed ${MAX_ROOMFAQ_LENGTH} characters.`);
		}

		text = text.replace(/^>/, '&gt;');

		const faqs = getRoomFaqs(room.roomid);
		faqs.set(topic, {
			content: text,
			aliases: [],
			name: topic,
			room: room.roomid,
		});
		saveRoomFaqs();
		this.sendReplyBox(Chat.formatText(text, true));
		this.privateModAction(`${user.name} added a FAQ for '${topic}'`);
		this.modlog('RFAQ', null, `added '${topic}'`);
	},
	removefaq(target, room, user) {
		if (!room) return this.requiresRoom();
		if (!this.canTalk()) return this.errorReply("You cannot do this while unable to talk.");
		if (!this.can('ban', null, room)) return false;
		if (!room.persist) return this.errorReply("This command is unavailable in temporary rooms.");
		const topic = toID(target);
		if (!topic) return this.parse('/help roomfaq');

		const faqs = getRoomFaqs(room.roomid);
		const aliases = getAliasesByRoom(room.roomid);
		const isFaq = !!faqs.get(topic);
		const isAlias = !!aliases.get(topic);
		if (!isFaq && !isAlias) return this.errorReply("Invalid topic.");
		if (isFaq) {
			faqs.delete(topic);
			for (const [alias, baseFaq] of aliases) {
				if (baseFaq === topic) aliases.delete(alias);
			}
		}
		if (isAlias) aliases.delete(topic);
		const database = new Sqlite(`${__dirname}/../../databases/chat-plugins.db`);
		if (isFaq) database.prepare(`DELETE FROM room_faqs WHERE name = ?`).run(topic);
		saveRoomFaqs();
		this.privateModAction(`${user.name} removed the FAQ for '${topic}'`);
		this.modlog('ROOMFAQ', null, `removed ${topic}`);
	},
	addalias(target, room, user) {
		if (!room) return this.requiresRoom();
		if (!this.canTalk()) return this.errorReply("You cannot do this while unable to talk.");
		if (!this.can('ban', null, room)) return false;
		if (!room.persist) return this.errorReply("This command is unavailable in temporary rooms.");
		const [alias, topic] = target.split(',').map(toID);

		if (!(alias && topic)) return this.parse('/help roomfaq');
		if (alias.length > 25) return this.errorReply("FAQ topics should not exceed 25 characters.");

		const roomAliases = getAliasesByRoom(room.roomid);
		const faqs = getRoomFaqs(room.roomid);
		if (!faqs.get(topic)) {
			return this.errorReply(`The topic ${topic} was not found in this room's faq list.`);
		}
		const baseTopic = roomAliases.get(alias);
		if (baseTopic) {
			return this.errorReply(`You cannot make an alias of an alias. Use /addalias ${alias}, ${baseTopic} instead.`);
		}
		roomAliases.set(alias, topic);
		saveRoomFaqs();
		this.privateModAction(`${user.name} added an alias for '${topic}': ${alias}`);
		this.modlog('ROOMFAQ', null, `alias for '${topic}' - ${alias}`);
	},
	viewfaq: 'roomfaq',
	rfaq: 'roomfaq',
	roomfaq(target, room, user, connection, cmd) {
		if (!room) return this.requiresRoom();
		const faqs = roomFaqs.get(room.roomid);
		if (!faqs) return this.errorReply("This room has no FAQ topics.");
		const topic: string = toID(target);
		if (topic === 'constructor') return false;
		if (!topic) {
			return this.sendReplyBox(`List of topics in this room: ${[...faqs.keys()].sort((a, b) => a.localeCompare(b)).map(rfaq => `<button class="button" name="send" value="/viewfaq ${rfaq}">${rfaq}</button>`).join(', ')}`);
		}
		const faq = getFaq(room.roomid, topic);
		if (!faq) return this.errorReply("Invalid topic.");

		if (!this.runBroadcast()) return;
		this.sendReplyBox(Chat.formatText(faq.content, true));
		// /viewfaq doesn't show source
		if (!this.broadcasting && user.can('ban', null, room) && cmd !== 'viewfaq') {
			const src = Utils.escapeHTML(faq.content).replace(/\n/g, `<br />`);
			let extra = `<code>/addfaq ${topic}, ${src}</code>`;
			const aliases: string[] = getFaqAliases(room.roomid, topic);
			if (aliases.length > 0) extra += `<br /><br />Aliases: ${aliases.join(', ')}`;
			this.sendReplyBox(extra);
		}
	},
	roomfaqhelp: [
		`/roomfaq - Shows the list of all available FAQ topics`,
		`/roomfaq <topic> - Shows the FAQ for <topic>.`,
		`/addfaq <topic>, <text> - Adds an entry for <topic> in this room or updates it. Requires: @ # &`,
		`/addalias <alias>, <topic> - Adds <alias> as an alias for <topic>, displaying it when users use /roomfaq <alias>. Requires: @ # &`,
		`/removefaq <topic> - Removes the entry for <topic> in this room. If used on an alias, removes the alias. Requires: @ # &`,
	],
};

process.nextTick(() => {
	Chat.multiLinePattern.register('/addfaq ');
});
