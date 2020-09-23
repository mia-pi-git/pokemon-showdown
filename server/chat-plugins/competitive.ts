import {Net} from '../../lib/net';
import {Statistics, MovesetStatistics, UsageStatistics} from 'smogon';

const STATS_KEYS = [
	'Checks and Counters', 'Raw count', 'usage', 'Viability Ceiling',
	'Abilities', 'Items', 'Spreads', 'Happiness', 'Moves', 'Teammates',
] as const;

type Elo = 0 | 1500 | 1630 | 1760;

export const UsageStats = new class {
	private statsCache: {[url: string]: UsageStatistics};
	constructor() {
		this.statsCache = {};
	}
	async parseMonth(tier: string, month?: string) {
		tier = this.getTier(tier);
		if (!month) {
			const previous = await Statistics.latestDate(tier);
			if (previous) {
				month = previous.date;
			} else {
				throw new Chat.ErrorMessage(`No stats for ${tier} found.`);
			}
		}
		return month;
	}
	parseUrl(url: string) {
		const parts = url.split('/');
		const tierString = parts.pop();
		const [tier, eloString] = tierString?.split('-')!;
		return {
			tier: tier,
			elo: parseInt(eloString.slice(0, -5)),
			month: parts.slice(0, -1).pop()!,

		};
	}
	async fetch(tier: string, month?: string, elo: Elo = 1500) {
		tier = this.getTier(tier);
		month = await this.parseMonth(tier, month);
		const url = `${Statistics.URL}/${month}/chaos/${tier}-${elo}.json`;
		const cachedStats = this.statsCache[url];
		if (cachedStats) return cachedStats;
		let raw;
		try {
			raw = await Net(url).get().then(Statistics.process);
		} catch (e) {
			if (e.name?.endsWith(`HttpError`)) {
				throw new Chat.ErrorMessage(`Error retrieving stats: ${e.message}.`);
			} else if (e.message.includes(`Request timeout`)) {
				throw new Chat.ErrorMessage(`Sorry! The request timed out. Please try again later.`);
			} else {
				throw e;
			}
		}
		this.statsCache[url] = raw;
		return this.statsCache[url];
	}
	async fetchPokemonStats(pokemon: string, tier: string, month?: string, elo: Elo = 1500) {
		tier = this.getTier(tier);
		pokemon = this.getSpecies(pokemon);
		if (!pokemon) throw new Chat.ErrorMessage(`Invalid Pokemon name.`);
		const monthStats = await this.fetch(tier, month, elo);
		return [monthStats.data[pokemon], monthStats.info['number of battles']] as [MovesetStatistics, number];
	}
	getName(key: string) {
		const id = toID(key);
		const pokemon = Dex.getSpecies(id);
		if (pokemon.exists) {
			return `<small><psicon pokemon="${id}"></small> ${pokemon.name}`;
		}
		const move = Dex.getMove(id);
		if (move.exists) return move.name;
		const ability = Dex.getAbility(id);
		if (ability.exists) return ability.name;
		const item = Dex.getItem(id);
		if (item.exists) {
			return `<small><psicon item="${id}"></small> ${item.name}`;
		}
		const nature = Dex.getNature(id);
		if (nature.exists) return nature.name;
		return key.charAt(0).toUpperCase() + key.slice(1);
	}
	getTier(name: string) {
		name = toID(name);
		if (!name) throw new Chat.ErrorMessage(`Invalid tier.`);
		const template = Dex.getFormat(name);
		if (!template.exists) throw new Chat.ErrorMessage(`The tier '${name}' does not exist.`);
		return template.id;
	}
	getSpecies(name: string) {
		name = toID(name);
		if (!name) throw new Chat.ErrorMessage(`Invalid Pokemon.`);
		const template = Dex.getSpecies(name);
		if (!template.exists) throw new Chat.ErrorMessage(`The Pokemon '${name}' does not exist.`);
		return template.name;
	}
	async showPokemon(pokemon: string, tier: string, month?: string, elo: Elo = 1500) {
		pokemon = this.getSpecies(pokemon);
		month = await this.parseMonth(tier, month);
		tier = this.getTier(tier);
		const [data, battlesNum] = await this.fetchPokemonStats(pokemon, tier, month, elo);
		if (!data) {
			throw new Chat.ErrorMessage(`No stats for ${pokemon} found on tier ${tier} during the month ${month}, with the rating ${elo}`)
		}
		let buf = `Usage stats for ${this.getName(pokemon)} `;
		buf += `on month ${month}, in ${Dex.getFormat(tier).name}, with the average ELO ${elo}:<br />`;
		for (const key of STATS_KEYS) {

		}
		return buf;
	}
	scrapeStats(pokemon: string, tier: string, stat: keyof MovesetStatistics, searchedElo: Elo = 1500) {
		pokemon = this.getSpecies(pokemon);
		tier = this.getTier(tier);
		const keys: string[] = STATS_KEYS.map(toID);
		if (!keys.includes(toID(stat))) {
			throw new Chat.ErrorMessage(`Invalid item to search usage stats for.`);
		}
		const key = STATS_KEYS[keys.indexOf(toID(stat))];
		let buf = `Usage statistics (${key}) for ${pokemon} in ${tier} <small>(Please note these are only from cached data)</small><br />`;
		for (const url in this.statsCache) {
			const {tier, month, elo} = this.parseUrl(url);
			if (elo !== searchedElo || this.getTier(tier) !== tier) continue;
			buf += `Results on ${month}: `;
			const stats = this.statsCache[url].data[pokemon];
			buf += stats[key];
			buf += `<br />`;
		}
		return buf;
	}
}

export const commands: ChatCommands = {
	async usage(target, room) {
		if (!toID(target)) return this.parse(`/help usage`);
		let [tier, pokemon, elo, month] = target.split(',');
		if (!tier && room?.battle) {
			tier = room.battle.format;
		}
		if (!tier)  return this.parse(`/help usage`);
		if (!pokemon) {
			if (this.shouldBroadcast()) {
				return this.errorReply(`Specify a Pokemon to broadcast this command.`);
			}
			return this.parse(`/j view-usage-${tier}`);
		}
		if (elo && ![1500, 1760, 0, 1630].includes(parseInt(elo))) {
			return this.errorReply(`Invalid ELO specified. Valid ELOs: 1500, 1760, 0, 1630.`);
		}
		this.sendReply(`Fetching usage stats, this may take some time....`);
		const data = await UsageStats.showPokemon(pokemon, tier, month, parseInt(elo || '1500') as Elo);
		this.runBroadcast();
		return this.sendReplyBox(data);
	},
	usagehelp: [
		`/usage [tier], [pokemon], (elo), (month) - Gets usage stats for [pokemon] in the [tier].`,
		`If no ELO is given, defaults to 1500. If no month is given, defaults to the current month.`,
	],
};

export const pages: PageTable = {
	async usage(args, user) {
		if (!user.named) return Rooms.RETRY_AFTER_LOGIN;
		args = args.filter(Boolean);
		let [tier, month] = args as [string, string | undefined];
		if (!tier) return this.errorReply(`Specify a tier.`);
		tier = UsageStats.getTier(tier);
		month = await UsageStats.parseMonth(tier, month);
		const {data} = await UsageStats.fetch(tier, month);
		let buf = `<div class="pad"><h3>Usage stats on ${tier} for ${month}:</h3>`;
		const statKeys = Object.keys(data).sort((a, b) => {
			const aStats = data[a];
			const bStats = data[b];
			return bStats["Raw count"] - aStats["Raw count"];
		});
		for (const mon of statKeys) {
			buf += `<br /><details><summary>${UsageStats.getSpecies(mon)}</summary>`;
			buf += await UsageStats.showPokemon(mon, tier, month);
			buf += `</details>`;
		}
		return buf;
	},
}
