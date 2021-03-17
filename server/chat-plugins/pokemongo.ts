import { pmmodchat } from '../../config/config-example';
import {Utils, Net, ProcessManager, Repl} from '../../lib';
import {Chat} from '../chat';

interface Raid {
	phase: string;
	ends: number;
	pokemon: Species;
	tier: number;
	host: string;
	in: ID[];
}

export const RaidManager = new class {
	raids: Map<ID, Raid> = Chat.oldPlugins.pokemongo?.RaidManager.raids || new Map<ID, Raid>();
	cleanInterval = this.getCleanTimer();
	display() {
		const room = Rooms.get('pokemongo');
		if (!room) return;
		let buf = `<center><div class="broadcast-blue"><strong>Ongoing raids:</strong>`;
		buf += `<br /><div class="ladder pad"><table><tr><td>`;
		const raids = [...this.raids].slice(0, 5);
		buf += raids.map(r => r[0]).join('</td><td>');
		buf += `</td></tr><td>`;
		buf += raids.map(r => `<psicon pokemon="${r[1].pokemon.id}" />`).join('</td><td>');
		buf += `</td></tr></table></div>`;
		buf += `<a href="/view-raids">View all${raids.length !== this.raids.size ? ` ${this.raids.size - 5} more` : ''}`;
		buf += `</a></div></center>`;
		room.add(`|uhtml|raids|${buf}`).update();
	}
	updatePageView() {
		const room = Rooms.get('pokemongo');
		if (!room) return;
		for (const user of Object.values(room.users)) {
			for (const conn of user.connections) {
				if (conn.openPages?.has('raids')) {
					void Chat.resolvePage('view-raids', user, conn);
				}
			}
		}
	}
	getCleanTimer() {
		if (this.cleanInterval) clearInterval(this.cleanInterval);
		return setInterval(() => {
			let changed = false;
			for (const [id, raid] of this.raids) {
				if (Date.now() > raid.ends) {
					this.raids.delete(id);
					changed = true;
				}
			}
			if (changed) this.display();
		}, 10 * 60 * 1000);
	}
	displayFor(user: User, sendToRoom = false) {
		const room = Rooms.get('pokemongo');
		if (!room) return;
		let buf = `<div class="broadcast-blue"><strong>Raids:</strong>`;
		if (this.raids.size > 2) {
			const raids = [...this.raids.values()].sort((a, b) => b.in.length - a.in.length);
			for (const [i, raid] of raids.entries()) {
				if (i > 1) break;
				buf += this.visualizeRaid(raid, user);
				buf += `</div><hr /><div class="broadcast-blue">`;
			}
			buf += `<a href="/view-raids">And ${Chat.count(this.raids.size - 2, 'more raids')}</a>`;
		} else if (this.raids.size) {
			for (const raid of this.raids.values()) {
				buf += this.visualizeRaid(raid, user);
			}
		} else {
			buf += `<br />All ongoing raids have ended.`;
		}
		buf += `</div>`;
		if (sendToRoom) user.sendTo(room.roomid, `|uhtml|raids|${buf}`);
	}
	visualizeRaid(raid: Raid, user?: User) {
		let buf = Utils.html`<center><strong>${raid.pokemon.name}</strong><hr />`;
		buf += `<psicon pokemon="${raid.pokemon.id}"><br />`;
		buf += Array(raid.tier).fill(Users.PLAYER_SYMBOL).join(' ');
		const hostId = toID(raid.host);
		buf += `<br />Ends in: ${Chat.toDurationString(raid.ends - Date.now())}`;
		buf += `${raid.phase === 'egg' ? ' (has not hatched)' : ''}<br />`;
		if (raid.in.length) {
			buf += `In: `;
			buf += raid.in.join(', ');
			buf += `<br />`;
		}
		if (user) {
			if (user.id === toID(raid.host)) {
				buf += `<button class="button" name="send" value="/msgroom pokemongo,/raids end ${hostId}">End</button>`;
			} else if (raid.in.includes(user.id)) {
				buf += `<button class="button" name="send" value="/msgroom pokemongo,/raids leave ${hostId}">Leave</button>`;
			} else {
				buf += `<button class="button" name="send" value="/msgroom pokemongo,/raids join ${hostId}">Join</button>`;
			}
			buf += `<br />`
		}
		buf += `<strong>Hosted by <span class="username">${raid.host}</span></strong><br />`;
		buf += `<button class="button" name="send" value="/msgroom pokemongo,/pogo dt ${raid.pokemon.id}">Info</button><br />`
		return buf;
	}
	host(user: User, pokemonName: string, timeString: string, tierString: string, phase?: string) {
		if (!phase) phase = 'started';
		if (!user.named || !user.autoconfirmed) {
			throw new Chat.ErrorMessage(`You must be autoconfirmed to host a raid.`);
		}
		if (this.raids.has(user.id)) {
			throw new Chat.ErrorMessage(`You're already hosting a raid.`);
		}
		const species = Dex.getSpecies(pokemonName);
		if (!species.exists) {
			throw new Chat.ErrorMessage(`Invalid species.`);
		}
		const time = parseInt(timeString) * 60 * 1000;
		if (time > 60 * 60 * 1000) {
			throw new Chat.ErrorMessage("Must be within an hour.");
		}
		if (time < 7 * 6 * 1000) {
			throw new Chat.ErrorMessage(`Too little time.`);
		}
		phase = toID(phase);
		if (!['egg', 'started'].includes(phase)) {
			throw new Chat.ErrorMessage(`Invalid raid phase.`);
		}
		const tier = parseInt(tierString);
		if (![1, 3, 5].includes(tier)) {
			throw new Chat.ErrorMessage(`Invalid raid tier.`);
		}
		this.raids.set(user.id, {
			pokemon: species,
			phase, tier,
			host: user.name,
			in: [user.id],
			ends: Date.now() + time,
		});
		this.display();
	}
	end(userId: ID) {
		if (!this.raids.has(userId)) {
			throw new Chat.ErrorMessage("No ongoing raid for that user.");
		}
		this.raids.delete(userId);
		this.display();
		this.updatePageView();
	}
	join(starter: string, user: User) {
		if (!user.autoconfirmed || !user.named) {
			throw new Chat.ErrorMessage(`You must be autoconfirmed to join raids.`);
		}
		const raid = this.raids.get(toID(starter));
		if (!raid) throw new Chat.ErrorMessage(`Raid not found.`);
		if (raid.in.includes(user.id)) {
			throw new Chat.ErrorMessage(`You're already in that raid.`);
		}
		raid.in.push(user.id);
		return true;
	}
	leave(starter: string, user: User) {
		const raid = this.raids.get(toID(starter));
		if (!raid) throw new Chat.ErrorMessage(`Raid not found.`);
		const idx = raid.in.indexOf(user.id);
		if (idx < 0) {
			throw new Chat.ErrorMessage(`You're not in that raid.`);
		}
		raid.in.splice(idx, 1);
		this.updatePageView();
		return true;
	}
}

export const GoData = new class {
	dexCache: {[k: string]: string[]} = {shadow: [], purified: [], normal: []};
	// .moveSettings
	moves: AnyObject[] = [];
	// .pokemonSettings
	pokemon: {shadow: AnyObject[], normal: AnyObject[], purified: AnyObject[]} = {shadow: [], normal: [], purified: []};
	// .genderSettings
	spawns: {shadow: AnyObject[], normal: AnyObject[], purified: AnyObject[]} = {shadow: [], normal: [], purified: []};
	items: AnyObject[] = [];
	async fetch(force = false) {
		const oldData = Chat.oldPlugins.pokemongo?.GoData;
		if (!force && oldData && oldData.moves.length) { // should always have items, otherwise we have an issue
			this.moves = oldData.moves;
			this.spawns = oldData.spawns;
			this.pokemon = oldData.pokemon;
			this.items = oldData.items;
			return;
		}
		// https://raw.githubusercontent.com/pokemongo-dev-contrib/pokemongo-game-master/master/versions/latest/V2_GAME_MASTER.json
		const raw = await Net('https://raw.githubusercontent.com/PokeMiners/game_masters/master/latest/latest.json').get();
		const data = JSON.parse(raw);
		for (const elem of data) {
			const type = this.parseType(elem.templateId);
			if (elem.data.pokemonSettings) {
				this.pokemon[type].push(elem.data);
			} else if (elem.data.genderSettings) {
				this.spawns[type].push(elem.data);
			} else if (elem.data.moveSettings) {
				this.moves.push(elem.data);
			} else if (elem.data.itemSettings) {
				this.items.push(elem.data);
			}
		}
	}
	parseType(templateId: string) {
		if (templateId.includes('PURIFIED')) return 'purified';
		if (templateId.includes('SHADOW')) return 'shadow';
		return 'normal';
	}
	validType(type: string) {
		return ['shadow', 'purified', 'normal'].includes(type);
	}
	getList(type: 'shadow' | 'purified' | 'normal') {
		const cache = this.dexCache[type];
		if (!cache.length) {
			const included = new Set();
			for (const species of this.pokemon[type]) {
				const id = toID(species.pokemonSettings.pokemonId);
				if (included.has(id)) continue;
				included.add(id);
				this.dexCache[type].push(id);
			}
			return cache;
		}
		return this.dexCache[type];
	}
	getPokemon(name: string, type = 'normal'): Promise<AnyObject | undefined> | AnyObject | undefined {
		if (PM.isParentProcess) {
			return this.query('pokemon', {type, name});
		}
		const {id} = Dex.getSpecies(name);
		for (const pokemon of this.pokemon[type as 'shadow' | 'purified' | 'normal']) {
			if (toID(pokemon.pokemonSettings.pokemonId) === id) {
				return pokemon.pokemonSettings as AnyObject;
			}
		}
	}
	async showPokemon(name: string, type = 'normal') {
		const species = Dex.getSpecies(name);
		if (!species.exists) throw new Chat.ErrorMessage(`Pokemon ${name} not found.`);
		const data = await this.getPokemon(name, type);
		if (!data || !Object.keys(data).length) {
			throw new Chat.ErrorMessage(
				`No data found for ${species.name} (${type}).` +
				(type !== 'normal' ? ` (Maybe try checking regular ${species.name}?)` : '')
			);
		}
		let buf = `<center><strong>${species.name}</strong><br /><psicon pokemon="${species.name}" />`;
		buf += `<br /><small>${data.stats.baseStamina} Stamina | ${data.stats.baseAttack} Atk | ${data.stats.baseDefense} Defense</small>`;
		buf += `<br />`;
		const types = [data.type, data.type2].filter(Boolean).map(t => this.toName(t.split('_').pop()));
		buf += types.map(t => `<psicon type="${t}" />`).join(' | ');
		buf += `<hr />`;

		buf += `<strong>Quick moves:</strong> `;
		buf += data.quickMoves.map(
			(move: string) => move.split('_').slice(0, -1).map(this.toName).join(' ')
		).join(', ');
		const legacyFast = data.eliteQuickMoves || data.eliteQuickMove;
		if (legacyFast) {
			buf += `, `;
			buf += legacyFast.map(
				(move: string) => `${move.split('_').slice(0, -1).map(this.toName).join(' ')} (legacy)`
			).join(', ');
		}

		buf += `<br /><strong>Charge moves:</strong> `;
		buf += data.cinematicMoves.map(
			(move: string) => move.split('_').map(this.toName).join(' ')
		).join(', ');
		const legacyCharge = data.eliteCinematicMoves || data.eliteCinematicMove;
		if (legacyCharge) {
			buf += `, `;
			buf += legacyCharge.map(
				(move: string) => `${move.split('_').map(this.toName).join(' ')} (legacy)`
			).join(', ');
		}

		if (data.encounter.baseCaptureRate) {
			buf += `<br /><strong>Catch rate:</strong> ${data.encounter.baseCaptureRate}%`;
		}

		if (data.isTransferable) {
			buf += `<br /><small>(Can be transferred)</small>`;
		}

		buf += `<br />`;
		const family = await this.getFamily(name);
		if (family.length > 1) { // family length === 1 means it's only that
			for (const [i, pokemon] of family.entries()) {
				const next = family[i + 1];
				if (Array.isArray(pokemon)) {
					buf += pokemon.map(p => `<psicon pokemon="${p}" />`).join(' OR ');
				} else if (typeof next === 'string' && next.endsWith('-MEGA')) {
					buf += `<psicon pokemon="${pokemon}" /> (<psicon pokemon="${family[i + 1]}" />)`;
					break;
				} else {
					buf += `<psicon pokemon="${pokemon}" /> ${next ? '&#x2192;' : ''}`;
				}
			}
		}
		return buf;
	}
	async query(req: string, args: AnyObject) {
		const result = await PM.query({req, params: args});
		if (result.error) {
			throw new Chat.ErrorMessage(result.error);
		}
		return result;
	}
	async showMove(moveName: string) {
		const data = await this.getMove(moveName);
		if (!data) throw new Chat.ErrorMessage(`Move ${moveName} not found.`);
		let buf = `<center><strong>${data.movementId.split('_').map(this.toName).join(' ')}</strong><br />`;
		buf += `<psicon type="${data.pokemonType.split('_').slice(2)[0]}" /><br />`;
		buf += `<strong>Damage:</strong> ${data.power}<br />`;
		buf += `<strong>Duration:</strong> ${Chat.toDurationString(data.durationMs)}`;
		return buf;
	}
	toName(name: string) {
		name = name.toLowerCase();
		return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
	}
	async getFamily(name: string):  Promise<string[]> {
		if (PM.isParentProcess) {
			return this.query('family', {name});
		}
		let results: string[] = [];
		const data = await this.getPokemon(name);
		if (!data) return results;
		results.push(data.pokemonId);
		const evos = this.getEvos(name);
		if (evos) {
			results.push(...evos);
		}
		const prevos = await this.getPrevos(name);
		for (const prevo of prevos.reverse()) {
			results.unshift(prevo);
		}
		return results;
	}
	getEvos(name: string) {
		const results: string[] = [];
		const data = this.getPokemon(name) as AnyObject;
		if (!data) return results;
		if (data.evolutionBranch) {
			if (data.evolutionBranch.length > 1) {
				results.push(data.evolutionBranch.map((p: AnyObject) => p.evolution));
			} else if (data.evolutionBranch[0].temporaryEvolution) {
				results.push(`${name.toUpperCase()}-MEGA`);
			} else {
				results.push(data.evolutionBranch[0].evolution);
			}
			for (const evo of data.evolutionBranch) {
				results.push(...this.getEvos(evo.evolution));
			}
		}
		return results;
	}
	async getPrevos(name: string) {
		const results: string[] = [];
		const data = await this.getPokemon(name);
		if (!data?.parentPokemonId) return results;
		let prevo = data.parentPokemonId;
		while (prevo) {
			results.unshift(prevo);
			prevo = (await this.getPokemon(prevo))?.parentPokemonId;
		}
		return results;
	}
	getItem(itemName: string):  Promise<AnyObject | undefined> | AnyObject | undefined  {
		const id = toID(itemName);
		if (PM.isParentProcess) {
			return this.query('item', {name: id});
		}
		for (const item of this.items) {
			const curId = item.itemSettings.itemId.slice(5);
			if (toID(curId).startsWith(id)) {
				return item.itemSettings;
			}
		}
	}
	async showItem(itemName: string) {
		const data = await this.getItem(itemName);
		if (!data) throw new Chat.ErrorMessage(`Item ${itemName} not found.`);
		let buf = `<center><strong>${data.itemId.split('_').slice(1).map(this.toName).join(' ')}</strong><hr />`;
		buf += `<strong>Level required: ${data.dropTrainerLevel}<br />`;
		buf += `<strong>Category:</strong> ${data.category.split('_').slice(2).map(this.toName).join(' ')}<br />`;
		const eff = data.food?.itemEffect;
		if (eff) {
			buf += `<strong>Effect: ${eff.split('_').slice(2).map(this.toName).join(' ')}<br />`;
		}
		return buf;
	}
	async getMove(moveName: string): Promise<AnyObject | undefined> {
		const id = toID(moveName);
		if (PM.isParentProcess) {
			return this.query('move', {name: id});
		}
		for (const move of this.moves) {
			if (toID(move.moveSettings.movementId) === id) {
				return move.moveSettings;
			}
		}
	}
	getEncounterData(pokemonName: string, type = 'normal') {
		const {id} = Dex.getSpecies(pokemonName);
		for (const encounter of this.spawns[type as 'normal' | 'shadow' | 'purified']) {
			if (toID(encounter.genderSettings.pokemon) === id) {
				return encounter;
			}
		}
	}
}

export function destroy() {
	clearTimeout(RaidManager.cleanInterval);
}

export const commands: ChatCommands = {
	raids: {
		host(target, room, user) {
			room = this.requireRoom('pokemongo' as RoomID);
			this.checkChat();
			const [pokemon, tier, time, phase] = target.split(',').map(i => i.trim());
			if (!pokemon || !tier || !time) {
				return this.parse(`/help raids host`);
			}
			RaidManager.host(user, pokemon, time, tier, phase);
		},
		hosthelp: [
			`/raids host [pokemon], [tier], [ending time][, phase] - Hosts a raid for the given [pokemon] with the [tier].`,
			`[time] marks the time when the raid ends, and [phase] marks the stage ('egg' or 'started')`,
		],

		join(target, room, user) {
			this.checkChat();
			room = this.requireRoom('pokemongo' as RoomID);
			if (!toID(target)) {
				return this.parse(`/help raids join`);
			}
			RaidManager.join(target, user);
			this.sendReply(`You joined ${target}'s raid.`);
			RaidManager.updatePageView();
			Users.get(target)?.sendTo('pokemongo' as RoomID, `${user.name} joined your raid.`);
		},
		joinhelp: [`/raids join [raid] - Joins the user to the given [raid].`],

		leave(target, room, user) {
			room = this.requireRoom('pokemongo' as RoomID);
			if (!toID(target)) {
				return this.parse(`/help raids leave`);
			}
			RaidManager.leave(target, user);
			RaidManager.updatePageView();
			this.sendReply(`Successfully left ${target}'s raid.`);
			Users.get(target)?.sendTo('pokemongo' as RoomID, `${user.name} left your raid.`);
		},
		leavehelp: [`/raids leave [raid] - Removes the current user from the given [raid], if they're in it.`],

		end(target, room, user) {
			room = this.requireRoom('pokemongo' as RoomID);
			target = toID(target);
			if (!target) {
				if (RaidManager.raids.get(user.id)) {
					target = user.id;
				} else {
					return this.parse(`/help raids end`);
				}
			}
			const raid = RaidManager.raids.get(target as ID);
			if (!raid) return this.errorReply(`Raid not found.`);
			const isForce = toID(raid.host) !== user.id;
			if (isForce) {
				this.checkCan('mute', null, room);
			}
			RaidManager.end(target as ID);
			if (isForce) {
				this.privateModAction(`${user.name} forcibly ended ${target}'s raid.`);
				this.modlog(`RAID END`, target);
			}
		},
		endhelp: [
			`/raid end [target user] - Ends the raid for the given [user]. If no user is given, defaults to user's current raid`,
			`Otherwise, requires: % @ & #`,
		],

		kick(target, room, user) {
			room = this.requireRoom('pokemongo' as RoomID);
			const [raidId, tarUser] = target.split(',').map(toID);
			if (!raidId || !tarUser) {
				return this.parse(`/help raids kick`);
			}
			const raid = RaidManager.raids.get(raidId);
			if (!raid) return this.errorReply(`That raid was not found.`);
			const isForce = toID(user) !== toID(raid.host);
			if (isForce) {
				this.checkCan('mute', null, room);
			}
			const idx = raid.in.indexOf(tarUser);
			if (idx > 0) {
				return this.errorReply(`That user isn't in that raid.`);
			}
			raid.in.splice(idx, 1);
			if (isForce) {
				this.privateModAction(`${user.name} forcibly removed ${tarUser} from ${raidId}'s raid.`);
				this.modlog(`RAID KICK`, tarUser, raidId);
			}
			RaidManager.display();
		},
		kickhelp: [`/raids kick [raid name], [user] - Kicks the [user] from the current [raid]. Requires: raid host % @ & #`],

		list(target, room) {
			return this.parse(`/join view-raids`);
		},

		view(target, room, user) {
			room = this.requireRoom('pokemongo' as RoomID);
			target = toID(target) || user.id;
			const raid = RaidManager.raids.get(target as ID);
			if (!raid) {
				return this.errorReply(`No raid found under that username.`);
			}
			const html = RaidManager.visualizeRaid(raid);
			this.runBroadcast();
			this.sendReplyBox(html);
		},
	},

	pogo: 'pokemongo',
	pokemongo: {
		dt: 'data',
		async data(target, room, user) {
			room = this.requireRoom('pokemongo' as RoomID);
			target = toID(target);
			let html;
			if (GoData.getPokemon(target)) {
				html = await GoData.showPokemon(target);
			} else if (await GoData.getMove(target)) {
				html = await GoData.showMove(target);
			} else if (await GoData.getItem(target)) {
				html = await GoData.showItem(target);
			} else {
				return this.errorReply(`Invalid data given. Specify a move, pokemon, or item.`);
			}
			this.runBroadcast();
			return this.sendReplyBox(html);
		},
		dex(target, room, user) {
			target = target.split(',').map(toID).join('-');
			return this.parse(`/join view-godex${target ? `-${target}` : target}`);
		},
	},
}

export const pages: PageTable = {
	raids(query, user) {
		if (!user.named) return Rooms.RETRY_AFTER_LOGIN;
		let buf = `<div class="pad"><h2>Ongoing raids</h2>`;
		for (const raid of RaidManager.raids.values()) {
			buf += `<div class="broadcast-blue">`;
			buf += RaidManager.visualizeRaid(raid, user);
			buf += `</div><br />`;
		}
		return buf;
	},
	async godex(query, user) {
		if (!user.named) return Rooms.RETRY_AFTER_LOGIN;
		if (query.length && !GoData.validType(query[0])) {
			const pokemon = query.shift()!;
			const type = query.shift() || 'normal';
			if (!['shadow', 'purified', 'normal'].includes(type)) {
				return this.errorReply(`Invalid type. Valid types: 'shadow', 'purified', 'normal' (default)`);
			}
			const typeString = type !== 'normal' ? ` (${type})` : '';
			this.title = `[GO Dex] ${pokemon}${typeString}`
			let buf = `<div class="pad"><h2>${Dex.getSpecies(pokemon).name}${typeString}</h2>`;
			buf += `<div class="broadcast-blue">`;
			buf += await GoData.showPokemon(pokemon, type);
			buf += `</div><center>`;
			buf += `<a class="blocklink" href="/view-godex" target="replace">Back</a></center></div>`;
			return buf;
		}

		const type = query.shift() || 'normal';
		if (!['shadow', 'purified', 'normal'].includes(type)) {
			return this.errorReply(`Invalid type. Valid types: 'shadow', 'purified', 'normal' (default)`);
		}
		this.title = `[GO Dex]`;
		let buf = `<div class="pad"><h2>Pokedex ${type !== 'normal' ? `(${type})` : ''}</h2><hr />`;
		let i = 0;
		const monList = await GoData.query('list', {type});
		for (const id of monList) {
			i++;
			buf += `<a class="button" href="/view-godex-${id}-${type}">`;
			buf += `<psicon pokemon="${id}" /></a> `;
			if (i % 10 === 0) {
				buf += `<br />`;
			}
		}
		return buf;
	},
};

const PM = new ProcessManager.QueryProcessManager<AnyObject, any>(module, query => {
	const {req, type, params} = query;
	let result;
	try {
		switch (req) {
		case 'pokemon':
			result = GoData.getPokemon(params.name, type);
			break;
		case 'item':
			result = GoData.getItem(params.name);
			break;
		case 'move':
			result = GoData.getMove(params.name);
			break;
		case 'list':
			result = GoData.getList(params.type);
			break;
		case 'family':
			result = GoData.getFamily(params.name);
			break;
		}
		if (!result) result = {};
		return result;
	} catch (e) {
		if (e.name?.endsWith('ErrorMessage')) {
			return {error: e.message};
		}
		throw e;
	}
});

if (!PM.isParentProcess) {
	global.Dex = require('../../sim').Dex;
	global.toID = Dex.toID;
	global.Config = require('../config-loader').Config;
	Repl.start('go-dex', cmd => eval(cmd));
	void GoData.fetch();
} else {
	PM.spawn(1);
}
