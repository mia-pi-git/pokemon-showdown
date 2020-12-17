import type {BattleAchievement, ChatAchievement} from './achievements';

export const achievements: {
	battle: {[k: string]: BattleAchievement},
	chat: {[k: string]: ChatAchievement},
} = {
	battle: {
		over9000: {
			checker(user, room, battle) {
				return battle.rated < 1500;
			},
			title: "IT'S OVER.. 1500?",
			desc: "Achieve more than 1500 elo in a format",
			tags: ['start'],
			id: 'over9000',
		},
		firefox: {
			async checker(user, room, battle) {
				if (battle.format.includes('monotype') || !battle.rated) return;
				const team = await battle.getTeam(user);
				if (!team) return;
				return team.every(p => Dex.getSpecies(p.species).types.includes('Fire'));
			},
			title: "Firefox",
			desc: "Used a monotype fire team in a non-Monotype format.",
			id: 'firefox',
			tags: ['start'],
		},
		chrome: {
			async checker(user, room, battle) {
				if (battle.format.includes('monotype') || !battle.rated) return;
				const team = await battle.getTeam(user);
				if (!team) return;
				return team.every(p => Dex.getSpecies(p.species).types.includes('Steel'));
			},
			title: "Chrome",
			desc: "Used a full team of Steel Pokemon in a non-Monotype format",
			id: 'chrome',
			tags: ['start'],
		},
		firstbattlewin: {
			// this is safely just the roomid since we only run it on battle win
			checker: (user, room, battle) => room.roomid,
			desc: 'Won your first battle!',
			title: "Victorious",
			tags: ['win'],
			id: "firstbattlewin",
		},
		monowin: {
			// this is safely just the roomid since we only run it on battle win
			checker(user, room, battle) {
				if (!battle.rated) return;
				return true;
			},
			title: "So, you want to be the very best?",
			desc: "Won a game of Monotype",
			id: 'monowin',
			tags: ['win'],
		},
		specialist: {
			checker(user, room, battle) {
				if (!battle.rated) return;
				const formatid = Dex.getFormat(battle.format).id.slice(`gen${Dex.gen}`.length);
				if (['randombattle', 'ou'].includes(formatid)) return;
				return true;
			},
			id: 'specialist',
			tags: ['start'],
			title: "Specialist",
			desc: "Played a game of a format other than Randbats or OU",
		},
		randbats: {
			checker(user, room, battle) {
				const format = Dex.getFormat(battle.format);
				if (!format.id.includes('randombattle')) return;
				return true;
			},
			tags: ['start'],
			desc: "Played Random Battle for the first time",
			title: "The Pokemon Showdown Special",
			id: 'randbats',
		},
		ssbb: {
			checker(user, room, battle) {
				if (!battle.format.includes('staffbros')) return;
				return true;
			},
			id: 'ssbb',
			title: "Nice to meet you!",
			desc: "Played a match of Super Staff Bros",
			tags: ["start"],
		},
		randshiny: {
			async checker(user, room, battle) {
				if (Dex.getFormat(battle.format).team !== 'random') return;
				// if user doesn't exist at the beginning of the battle smth has gone _very_ wrong
				const team = await battle.getTeam(Users.get(user)!);
				const shinies = team ? team.filter(p => p.shiny) : [];
				if (!shinies.length) return;
				return true;
			},
			id: 'randshiny',
			title: "Something sparkly!",
			desc: "Got a shiny Pokemon in Random Battle",
			tags: ['start'],
			nonotify: true,
		},
		laddertop: {
			async checker(user, room, battle) {
				if (!battle.rated) return;
				const result = await Ladders(battle.format).getLadder();
				if (user === result[0][0]) return true;
			},
			title: "The very best",
			desc: "Hit the top of a ladder",
			id: 'laddertop',
			tags: ["end"],
		},
	},
	chat: {
		theway: {
			checker(user, room, context) {
				if (!room) return;
				return true;
			},
			title: "This is the Way",
			desc: "Spoke in a chatroom for the first time!",
			id: 'theway',
			tags: ['chat'],
		},
		joinroom: {
			checker(user, room) {
				if (!room || Rooms.global.chatRooms.some(r => r.users[user.id])) return;
				return true;
			},
			title: "Internet Explorer",
			desc: "Joined a room for the first time",
			id: 'joinroom',
			tags: ['joinroom'],
		},
		offertie: {
			checker(user, room, context) {
				if (!context || !context.handler || !['offerdraw', 'requesttie', 'offertie'].includes(context.cmd)) {
					return;
				}
				return true;
			},
			tags: ["command"],
			title: "Diplomat",
			desc: "Offered a tie in battle",
			id: "offertie",
		},
		firstcmd: {
			checker(user, room, context) {
				if (!context || !context.handler) return;
				return true;
			},
			tags: ["command"],
			id: "firstcmd",
			title: "Commander",
			desc: "Used a chat command for the first time",
		},
		helproom: {
			checker(user, room) {
				if (!room || room.roomid !== 'help') return;
				return room.title;
			},
			desc: "Joined the Help room for the first time",
			title: "Everything OK?",
			id: 'helproom',
			tags: ['joinroom'],
		},
		rules: {
			checker(user, room, context) {
				if (!context || context.cmd !== 'rules') return;
				return context.cmd;
			},
			desc: "Read the Rules",
			title: "Future Lawyer",
			id: 'rules',
			tags: ["command"],
		},
		wifiga: {
			checker(user, room, context) {
				if (!context || !context.handler) return;
				if (!['gts start', 'gts new', 'lottery', 'lg'].includes(context.fullCmd)) return;
				const giver = context.target.split(context.target.includes('|') ? '|' : ',').map(toID)[0];
				if (!this.hasAchievement(giver, "wifiga")) {
					this.give("wifiga", giver);
				}
				return;
			},
			title: "Kind Stranger",
			id: 'wifiga',
			desc: "Hosted a giveaway in the Wi-Fi room",
			tags: ['command'],
			targeted: true,
		},
		matrix: {
			checker(user, room, context) {
				return context && context.cmd === 'help';
			},
			title: "In the Matrix",
			id: 'matrix',
			desc: "Used the /help command and see many commands at once",
			tags: ['command'],
		},
	},
};
