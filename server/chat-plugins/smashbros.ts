/**
 * Plugin to view smashbros game data.
 * By Mia.
 * @author mia-pi-git
 */
import {FS} from '../../lib/fs';
import {Utils} from '../../lib/utils';

const STORAGE_PATH = `config/chat-plugins/smash.json`;
const ATTRIBUTES = [
	'Air acceleration', 'Air dodge', 'Air friction', 'Air speed', 'Dash', 'Double jump',
	'Falling speed', 'Fast fall', 'Fighter ability', 'Gravity', 'Jump', 'Roll',
	'Spot dodge', 'Traction', 'Walk', 'Weight',
] as const;
const REQUIRED_ATTRIBUTES = [
	"Weight", "Walk", "Dash", "Air speed", "Falling speed", "Fast fall", "Double jump",
] as const;
const REQUIRED_MOVE_KEYS = [
	"Startup", "Frame", "Endlag", "FAF", "Shield Stun", "Damage",
] as const;

const VALID_CATS = [
	"Legal (Starter)", "Legal (Counter-Pick)", "Sometimes Legal", "Not Legal",
] as const;

interface Move {
	name: string;
	startup?: string;
	frame?: string;
	endlag?: string;
	faf?: string;
	shieldstun?: string;
	damage?: string;
	image?: string;
}

interface Attribute {
	name: string;
	frame?: string;
	value: string;
}

interface Character {
	name: string;
	moves: string[];
	image?: {url: string, height: number, width: number};
	attributes: Attribute[];
}

export const Smash = new class {
	characters: Map<string, Character>;
	moves: Map<string, Move>;
	categories: Map<string, string[]>;
	constructor() {
		this.characters = new Map();
		this.moves = new Map();
		this.categories = new Map();
		this.load();
	}
	load() {
		const raw = JSON.parse(FS(STORAGE_PATH).readIfExistsSync() || "{}");
		if (raw.moves) {
			for (const k in raw.moves) {
				this.moves.set(k, raw.moves[k]);
			}
		}
		if (raw.characters) {
			for (const k in raw.characters) {
				this.characters.set(k, raw.characters[k]);
			}
		}
		if (raw.categories) {
			for (const k in raw.categories) {
				this.categories.set(k, raw.categories[k]);
			}
		} else {
			for (const key of VALID_CATS.map(toID)) {
				if (!this.categories.has(key)) this.categories.set(key, []);
			}
			this.save();
		}
		return raw;
	}
	save() {
		const data: AnyObject = {};
		data.moves = {};
		for (const [id, entry] of this.moves) {
			data.moves[id] = entry;
		}
		data.characters = {};
		for (const [id, entry] of this.characters) {
			data.characters[id] = entry;
		}
		data.categories = {};
		for (const [k, vals] of this.categories) {
			data.categories[k] = vals;
		}
		FS(STORAGE_PATH).writeUpdate(() => JSON.stringify(data));
	}
	addMove(name: string, opts: string[], image?: string) {
		const id = toID(name);
		const entry: Move = {name, image};
		const moveKeyIDs = REQUIRED_MOVE_KEYS.map(toID);
		const includedTypes = new Set();
		for (const opt of opts) {
			const [type, value] = Utils.splitFirst(opt, ':');
			const typeID = toID(type);
			if (includedTypes.has(typeID)) {
				throw new Chat.ErrorMessage(`Duplicated property: ${typeID}`);
			}
			includedTypes.add(typeID);
			entry[typeID as keyof Move] = value;
		}
		const included = moveKeyIDs.filter(item => includedTypes.has(item));
		if (included.length !== moveKeyIDs.length) {
			throw new Chat.ErrorMessage(
				`You are missing a required move attribute (${moveKeyIDs.join(', ')}).` +
				` You included ${[...includedTypes].join(', ') || 'no attributes'}.`
			);
		}
		this.moves.set(id, entry);
		this.save();
		return true;
	}
	removeMove(name: string) {
		const id = toID(name);
		if (!this.moves.get(id)) {
			throw new Chat.ErrorMessage(`That move is not in the index.`);
		}
		this.moves.delete(id);
		const deleted = [];
		for (const character of this.characters.values()) {
			if (character.moves.includes(id)) {
				const index = character.moves.indexOf(id);
				deleted.push(character.name);
				character.moves.splice(index);
			}
		}
		this.save();
		return deleted;
	}
	async addCharacter(
		name: string, attributes: string[], moves: string[], image?: string
	): Promise<Character> {
		if (image && (!Chat.linkRegex.test(image) || !/\.(png|jpg|gif)/.test(image))) {
			throw new Chat.ErrorMessage(`Invalid image link.`);
		}
		const entry: Partial<Character> = {name};
		if (image) {
			const [width, height] = await Chat.fitImage(image);
			entry.image = {url: image, width, height};
		}
		const addedAttributes = new Set();
		const attributeIDs = ATTRIBUTES.map(toID);
		for (const attribute of attributes) {
			const [type, val] = Utils.splitFirst(attribute, ':').map(item => item.trim());
			if (!entry.attributes) entry.attributes = [];
			const typeID = toID(type);
			if (addedAttributes.has(typeID)) throw new Chat.ErrorMessage(`You have a duplicated attribute (${typeID}).`);
			addedAttributes.add(typeID);
			const index = attributeIDs.indexOf(typeID);
			if (index < 0) throw new Chat.ErrorMessage(`Invalid attribute: ${typeID}`);
			entry.attributes.push({
				// custom attribs
				name: ATTRIBUTES[index] || type,
				value: val,
			});
		}
		if (
			REQUIRED_ATTRIBUTES.map(toID)
				.filter(item => addedAttributes.has(item)).length !== REQUIRED_ATTRIBUTES.length
		) {
			throw new Chat.ErrorMessage(`You are missing a required attribute. (${REQUIRED_ATTRIBUTES.join(', ')})`);
		}
		for (const move of moves) {
			const moveID = toID(move);
			if (!this.moves.get(moveID)) {
				throw new Chat.ErrorMessage(`Invalid move: ${move}`);
			}
			if (!entry.moves) entry.moves = [];
			entry.moves.push(moveID);
		}
		this.characters.set(toID(name), entry as Character);
		this.save();
		return entry as Character;
	}
	display(character: Character) {
		let buf = `<strong>${character.name}</strong>`;
		if (character.image) {
			const {url, height, width} = character.image;
			buf += `<br /><img src="${url}" width="${width}" height="${height}"><br />`;
		}
		buf += `<div class="ladder pad"><table><tr><strong>Attributes</strong></tr>`;
		buf += `<tr><th>Attribute</th><th>Data</th></tr>`;
		buf += character.attributes.map(attribute => (
			`<tr><td>${attribute.name}</td><td>${attribute.value}</td></tr>`
		)).join('');
		buf += `</table></div>`;
		buf += `<details><summary>Move data</summary>`;
		buf += `<div class="ladder pad"><table>`;
		buf += `<tr>${REQUIRED_MOVE_KEYS.map(item => `<th>${item}</th>`).join('')}</tr>`;
		buf += character.moves.map(moveID => {
			const move = this.moves.get(moveID);
			if (!move) return null;
			return `<tr>${REQUIRED_MOVE_KEYS.map(item => `<td>${move[toID(item) as keyof Move]}</td>`)}</tr>`;
		}).filter(Boolean).join('');
		buf += `</table></div></details>`;
		return buf;
	}
	search(target: string, nameOnly = false): Character[] {
		target = toID(target);
		const buffer: string[] = [];
		for (const [id, char] of this.characters) {
			if (target === id) {
				// if the name = the id, they're probably searching for that character
				// force return here
				return [char];
			}
			if (!nameOnly) {
				for (const move of char.moves) {
					for (const key in this.moves.get(move)!) {
						if (toID(key) === target) buffer.push(id);
					}
				}
				for (const attribute of char.attributes) {
					const {name, value} = attribute;
					if (toID(name) === target) buffer.push(id);
					if (value === target) buffer.push(id);
				}
			}
		}
		return buffer.sort((a, b) => {
			// prioritize items with the most occurances
			const aCount = buffer.filter(item => item === a).length;
			const bCount = buffer.filter(item => item === b).length;
			return bCount - aCount;
		}).map(item => this.characters.get(item) as Character);
	}
	compare(char1: string, char2: string) {
		const character1 = this.characters.get(toID(char1));
		const character2 = this.characters.get(toID(char2));
		if (!character1 || !character2) {
			throw new Chat.ErrorMessage(`Invalid characters.`);
		}
		let buf = `<strong>Comparing ${character1.name} and ${character2.name}:</strong><br />`;
		buf += `<details><summary>Moves</summary><div class="ladder pad"><table>`;
		for (const [i, moveName] of character1.moves.entries()) {
			buf += `<tr>`;
			const moveID = toID(moveName);
			const move1 = this.moves.get(moveID)!;
			const moveID2 = character2.moves[i];
			const move2 = this.moves.get(moveID2)!;
			const result: [Move, string][] = [[move1, toID(char1)], [move2, toID(char2)]];
			const sorted = result.sort((a, b) => (parseInt(b[0].damage!) || 0) - (parseInt(a[0].damage!) || 0));
			buf += sorted.map(item => `<td>${item[0]?.name} (${item[1]})</td>`).join('');
			buf += `</tr>`;
		}
		buf += `</table></div></details><details><summary>Attributes</summary>`;
		buf += `<div class="ladder pad"><table>`;
		buf += `<tr><th>Name</th><th>Winner</th><th>Loser</th></tr>`;
		const char1Attribs = character1.attributes;
		const char2Attribs = character2.attributes;
		for (const attrib of REQUIRED_ATTRIBUTES) {
			buf += `<tr><td><strong>${attrib}</strong<</td>`;
			const char1Count = parseInt(char1Attribs.filter(item => toID(item.name) === toID(attrib))[0]?.value || '0');
			const char2Count = parseInt(char2Attribs.filter(item => toID(item.name) === toID(attrib))[0]?.value || '0');
			if (isNaN(char1Count) || isNaN(char2Count)) continue;
			const sorted = [[char1Count, character1.name], [char2Count, character2.name]].sort((a, b) => (
				(b[0] as number) - (a[0] as number)
			)).map(item => item[1]);
			buf += sorted.map(item => `<td>${item}</td>`).join('');
			buf += `</tr>`;
		}
		buf += `</details>`;
		return buf;
	}
};

export const commands: ChatCommands = {
	smash: 'smashbros',
	smashbros: {
		''() {
			return this.parse(`/join view-smashbros`);
		},
		view(target, room, user) {
			room = this.requireRoom('smashbros' as RoomID);
			this.runBroadcast();
			if (!target) return this.parse(`/join view-smashbros`);
			const character = Smash.search(target)[0];
			if (!character) return this.errorReply(`Character not found.`);
			this.sendReplyBox(Smash.display(character));
		},
		async add(target, room, user) {
			room = this.requireRoom('smashbros' as RoomID);
			this.checkCan('mute', null, room);
			let [name, attributes, moves, image] = Utils.splitFirst(target, '|', 3);
			const char = Smash.characters.get(toID(name));
			if (!name || !char && (!moves || !attributes)) {
				return this.parse(`/smash help`);
			}
			if (!moves && char) {
				moves = char?.moves.join(',');
			}
			const ids = attributes.split(',').map(item => item.split(':')[0]).map(toID);
			if (ids.length < REQUIRED_ATTRIBUTES.length && char) {
				const rebuilt: string[] = REQUIRED_ATTRIBUTES.map(item => {
					const id = toID(item);
					const existing = char.attributes.find(attrib => toID(attrib.name) === id);
					if (!existing || ids.includes(id)) return '';
					return `${id}:${existing.value}`;
				}).filter(Boolean);
				attributes = attributes.split(',').concat(rebuilt).join(',');
			}
			await Smash.addCharacter(name, attributes.split(','), moves.split(','), image);
			this.privateModAction(`${user.name} added an entry for the Smash character '${name}'`);
			this.modlog(`SMASHBROS ADD`, null, `${name}: Attributes: ${attributes} / Moves: ${moves} (image: ${image || 'none'})`);
		},
		remove(target, room, user) {
			room = this.requireRoom('smashbros' as RoomID);
			this.checkCan('mute', null, room);
			target = toID(target);
			const char = Smash.characters.get(target);
			if (!char) return this.errorReply(`Character not found.`);
			Smash.characters.delete(target);
			Smash.save();
			this.privateModAction(`${user.name} removed the character '${target}'.`);
			this.modlog(`SMASHBROS REMOVE`, null, target);
		},
		compare(target, room, user) {
			room = this.requireRoom('smashbros' as RoomID);
			this.runBroadcast();
			const [tar1, tar2] = Utils.splitFirst(target, ',').map(item => item.trim());
			if (!toID(target) || !tar1 || !tar2) return this.parse(`/smash help`);
			const result = Smash.compare(tar1, tar2);
			this.sendReplyBox(result);
		},
		async move(target, room, user) {
			room = this.requireRoom('smashbros' as RoomID);
			target = toID(target);
			if (!target) return this.parse(`/smash help`);
			const move = Smash.moves.get(target);
			if (!move) return this.errorReply(`Move does not exist.`);
			this.runBroadcast();
			let buffer = ``;
			for (const key in move) {
				if (key === 'image') {
					const [width, height] = await Chat.fitImage(move.image!);
					buffer += `<br /><img src="${move.image}" height="${height} width="${width}"><br />`;
					continue;
				}
				buffer += `<br />${key}: ${move[toID(key) as keyof Move]}`;
			}
			this.sendReplyBox(
				`<strong>${move.name}</strong>` +
				`${buffer}`
			);
		},
		addmove(target, room, user) {
			room = this.requireRoom('smashbros' as RoomID);
			const [name, details, image] = Utils.splitFirst(target, '|', 3).map(arg => arg.trim());
			if (!name || !details || !target) {
				return this.parse(`/smash help`);
			}
			Smash.addMove(name, details.split(','), image);
			Smash.save();
			this.privateModAction(`${user.name} added data for move '${name}' to the Smash database.`);
			this.modlog(`SMASH ADDMOVE`, null, `${name}: ${details} ${image ? `(${image})` : ''}`);
		},
		deletemove(target, room, user) {
			room = this.requireRoom('smashbros' as RoomID);
			target = toID(target);
			if (!target) return this.parse(`/smashbros help`);
			if (!Smash.moves.get(target)) {
				return this.errorReply(`Move ${target} does not exist.`);
			}
			const hadMove = Smash.removeMove(target);
			this.privateModAction(`${user.name} deleted data for the move '${target}' from the Smash database.`);
			const removedMessage = `Removed move from ${hadMove.join(', ')}`;
			this.sendReply(removedMessage);
			this.roomlog(removedMessage);
			this.modlog(`SMASH DELETEMOVE`, null, target);
		},
		addtocategory(target, room, user) {
			room = this.requireRoom('smashbros' as RoomID);
			this.checkCan('mute', null, room);
			const [cat, val] = Utils.splitFirst(target, ',');
			const catID = toID(cat);
			const catData = Smash.categories.get(catID);
			if (!catData) {
				return this.errorReply(`Invalid category.`);
			}
			if (catData.includes(val)) {
				return this.errorReply(`Category ${catID} already has the value ${val}.`);
			}
			catData.push(val);
			Smash.save();
			this.privateModAction(`${user.name} added the data '${val}' to category ${catID}.`);
			this.modlog(`SMASH ADDTOCATEGORY`, null, `${catID}: ${val}`);
		},
		removefromcategory(target, room, user) {
			room = this.requireRoom('smashbros' as RoomID);
			this.checkCan('mute', null, room);
			const [cat, val] = Utils.splitFirst(target, ',');
			const catID = toID(cat);
			const catData = Smash.categories.get(catID);
			if (!catData) {
				return this.errorReply(`Invalid category.`);
			}
			const index = catData.indexOf(val);
			if (index < 0) {
				return this.errorReply(`That data is not in the category ${catID}.`);
			}
			catData.splice(index, 1);
			Smash.save();
			this.privateModAction(`${user.name} removed the data '${val}' from category ${catID}.`);
			this.modlog(`SMASH REMOVEFROMCATEGORY`, null, `${catID}: ${val}`);
		},
		stages(target, room, user) {
			room = this.requireRoom('smashbros' as RoomID);
			let buffer = '';
			for (const cat of VALID_CATS) {
				buffer += `<details><summary>${cat}</summary>`;
				buffer += Smash.categories.get(toID(cat))?.join(', ') || `No data in category.`;
				buffer += `</details>`;
			}
			this.runBroadcast();
			return this.sendReplyBox(buffer);
		},
		help() {
			this.runBroadcast();
			return this.sendReplyBox([
				`/smashbros view [name] - View data for the Smashbros character [name], if it's in the database.`,
				`/smashbros add [name] | [attributes] | [moves] | [image link] - Adds data for the Smash character [name].`,
				`[attributes] and [moves] should both be separated by commas. Moves must be added with /smashbros addmove first.`,
				`[Attributes] are in the format [name]: [data]. Requires: % @ # &`,
				`/smashbros remove [name] - removes data for [name] from the database, if it exists. Requires: % @ # &`,
				`/smashbros compare [character1], [character2] - Compares data for [character1] and [character2].`,
				`/smashbros addmove [move] | [data] | [optional image] - Adds [data] for [move] to the database. Requires: % @ # &`,
				`/smashbros deletemove [move] - Deletes data for the [move] from the database. Requires: % @ # &`,
			].join('<br />'));
		},
	},
};

export const pages: PageTable = {
	smashbros(args, user) {
		if (!user.named) return Rooms.RETRY_AFTER_LOGIN;
		this.title = `[Smash Bros]`;
		let buffer = '<div class="pad"><h2>Characters in the Smash Bros database:</h2>';
		for (const character of Smash.characters.values()) {
			buffer += `<br /><div class="infobox">`;
			buffer += Smash.display(character);
			buffer += `</div><br />`;
		}
		buffer += `<h2>Moves:</h2><br />`;
		buffer += `<div class="ladder pad"><table><tr><th>Name</th>`;
		buffer += REQUIRED_MOVE_KEYS.map(item => `<th>${item}</th>`).join('');
		buffer += `</tr>`;
		const moveKeyIDs = REQUIRED_MOVE_KEYS.map(toID);
		for (const move of Smash.moves.values()) {
			buffer += `<tr><th>${move.name}</th>`;
			buffer += moveKeyIDs.map(item => `<td>${move[item as keyof Move]}</td>`).join('');
			buffer += `</tr>`;
		}
		buffer += `</table></div>`;
		return buffer;
	},
};
