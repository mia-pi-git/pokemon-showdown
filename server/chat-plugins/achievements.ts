/**
 * Achievements plugin.
 * Supports automatic achievements (stored in chat-plugins/achievement-data)
 * as well as achievements manually given by public rooms.
 * By Mia
 * @author mia-pi-git
 */
import {achievements} from './achievement-data';
import {FS} from '../../lib/fs';
import {Utils} from '../../lib/utils';

const PATH = `config/chat-plugins/achievements.json`;

type AchievementTypes = "battle" | "chat";
type HandlerResult = string | void | boolean | Promise<string | void | boolean>;

export interface Achievement {
	tags: string[];
	title: string;
	id: string;
	desc: string;
	targeted?: boolean;
	nonotify?: boolean;
	checker: (...args: any) => any;
}

export interface ChatAchievement extends Achievement {
	checker: (
		this: typeof Achievements, user: User, room: Room | null | undefined, context?: CommandContext
	) => HandlerResult;
	roomSpecific?: RoomID;
}

export interface BattleAchievement extends Achievement {
	checker: (this: typeof Achievements, user: ID, room: Room, battle: Rooms.RoomBattle) => HandlerResult;
}
// index by id
interface AchievementData {
	title: string;
	badge?: string;
	type: AchievementTypes;
	desc: string;
	date: string;
	room?: string;
}

interface UserData {
	[user: string]: {
		[k: string]: AchievementData,
	};
}

// indexed by id
export let achievementData: {
	userlist: UserData,
	roomdata: {[roomid: string]: {[k: string]: Omit<AchievementData, 'date'>}},
} = {
	userlist: {}, roomdata: {},
};

try {
	achievementData = JSON.parse(FS(PATH).readIfExistsSync() || "{}");
} catch (e) {}

export const Achievements = new class {
	findAchievements(type: AchievementTypes, search: string) {
		const found: Achievement[] = [];
		for (const h in achievements[type]) {
			if (h.includes(search) || achievements[type][h].tags.includes(search)) found.push(achievements[type][h]);
		}
		return found;
	}
	hasAchievement(user: ID, achievementId: string) {
		const cachedData = achievementData.userlist[user];
		if (!cachedData) return false;
		return !!cachedData[achievementId];
	}
	get(id: string) {
		for (const achievementType in achievements) {
			const typeAchievements = achievements[achievementType as AchievementTypes];
			for (const k in typeAchievements) {
				const curHandler = typeAchievements[k];
				if (k === id) return {achievement: curHandler, type: achievementType as AchievementTypes};
			}
		}
	}
	give(id: string, user: ID) {
		if (user.includes('guest')) return;
		const result = this.get(id)!;
		const {type, achievement} = result;
		if (!achievementData.userlist[user]) achievementData.userlist[user] = {};
		achievementData.userlist[user][achievement.id] = {
			title: achievement.title, type, desc: achievement.desc,
			date: Chat.toTimestamp(new Date()),
		};
		this.notify(achievement, user);
		this.save();
	}
	notify(achievement: Achievement, userid: ID) {
		if (achievement.nonotify) return;
		const user = Users.get(userid);
		if (!user) return;
		user.send(
			`|pm|~|${user.getIdentity()}|/nonotify You received the achievement ${achievement.title}!`
		);
		user.send(
			`|pm|~|${user.getIdentity()}|/nonotify (Use /achievements list to see more information)`
		);
	}
	save() {
		return FS(PATH).writeUpdate(() => JSON.stringify(achievementData));
	}
	list(user: ID) {
		let buf = "";
		const userData = achievementData.userlist[user];
		if (!userData) {
			buf += `<h2>User not found.</h2>`;
			return buf;
		}
		buf += `<div class="pad"><h2>${user}'s achievements:</h2></hr />`;
		for (const k in userData) {
			const achievement = userData[k];
			buf += `<strong>${achievement.title}</strong> <small>(${k})</small>`;
			buf += `<br />${achievement.desc}`;
			buf += `<br />(achieved on ${achievement.date.split(' ')[0]})`;
			if (achievement.room) {
				buf += `<br />Awarded by ${achievement.room}`;
			}
			buf += `<hr />`;
		}
		return buf;
	}
	async runAchievement(user: ID, achievementId: string, args: any[]) {
		const {achievement} = this.get(achievementId) || {};
		if (!achievement) return false;

		if (this.hasAchievement(user, achievementId) && !achievement?.targeted) return false;
		let result;
		try {
			// @ts-ignore
			result = await achievement.checker.call(this, args[0], args[1], args[2]);
		} catch (e) {
			Monitor.crashlog(e, "An achievement handler", {user, achievementId, ...args});
			return false;
		}
		if (!result) return false;
		return this.give(achievementId, user);
	}
	runAll(type: AchievementTypes, id: ID, user: ID, args: any[]) {
		const found = this.findAchievements(type, id);
		for (const handler of found) {
			void this.runAchievement(user, handler.id, args);
		}
	}
	getRoomData(room: RoomID) {
		let data = achievementData.roomdata[room];
		if (!data) {
			data = achievementData.roomdata[room] = {};
		}
		return data;
	}
	getUserData(user: ID) {
		let data = achievementData.userlist[user];
		if (!data) {
			data = achievementData.userlist[user] = {};
		}
		return data;
	}
};

export const commands: ChatCommands = {
	achievements: {
		list(target, room, user) {
			return this.parse(`/j view-achievements-${toID(target)}`);
		},
		roomadd(target, room, user) {
			room = this.requireRoom();
			this.checkCan('ban', null, room);
			if (room.settings.isPrivate !== undefined) {
				return this.errorReply(`Only public rooms may add achievements.`);
			}
			let [id, name, desc] = Utils.splitFirst(target, ',', 3);
			id = toID(id);
			if (name.length > 50) return this.errorReply("Achievement name is too long.");
			if (desc.length > 150) return this.errorReply("Description is too long.");
			const roomData = Achievements.getRoomData(room.roomid);
			roomData[id] = {
				title: name, desc, type: "chat",
			};
			Achievements.save();
			this.privateModAction(`${user.name} added the room achievement ${name}.`);
			this.modlog(`ACHIVEMENT ADD`, null, `${name}: ${desc}`);
		},
		roomdelete(target, room, user) {
			room = this.requireRoom();
			this.checkCan('ban', null, room);
			if (room.settings.isPrivate !== undefined) {
				return this.errorReply(`Only public rooms may use achievements.`);
			}
			target = toID(target);
			const roomData = Achievements.getRoomData(room.roomid);
			if (!roomData[target]) {
				return this.errorReply(`Achievement not found.`);
			}
			delete roomData[target];
			Achievements.save();
			this.privateModAction(`${user.name} deleted the achievement ${target}.`);
			this.modlog(`ACHIEVEMENT REMOVE`, null, target);
		},
		roomgive(target, room, user) {
			room = this.requireRoom();
			this.checkCan('ban', null, room);
			if (room.settings.isPrivate !== undefined) {
				return this.errorReply(`Only public rooms may use achievements.`);
			}
			const [tarUser, achievement] = Utils.splitFirst(target, ',').map(toID);
			const roomData = Achievements.getRoomData(room.roomid);
			if (!roomData[achievement]) return this.errorReply(`Achievement not found.`);
			if (Achievements.hasAchievement(tarUser, achievement)) {
				return this.errorReply(`That user already has that achievement.`);
			}
			const userData = Achievements.getUserData(tarUser);
			userData[achievement] = {
				...roomData[achievement], date: Chat.toTimestamp(new Date()), room: room.title,
			};
			Achievements.save();
			this.addModAction(`${user.name} awarded the achievement ${roomData[achievement].title} to ${tarUser}.`);
			this.modlog(`ACHIEVEMENT GIVE`, tarUser, achievement);
		},
		roomremove(target, room, user) {
			room = this.requireRoom();
			this.checkCan('ban', null, room);
			if (room.settings.isPrivate !== undefined) {
				return this.errorReply(`Only public rooms may use achievements.`);
			}
			const [tarUser, achievement] = Utils.splitFirst(target, ',').map(toID);
			const roomData = Achievements.getRoomData(room.roomid);
			if (!roomData[achievement]) return this.errorReply(`Achievement not found.`);
			if (!Achievements.hasAchievement(tarUser, achievement)) {
				return this.errorReply(`That user doesn't have that achievement.`);
			}
			const userData = Achievements.getUserData(tarUser);
			delete userData[achievement];
			Achievements.save();
			this.privateModAction(`${user.name} removed the achievement ${achievement} from ${tarUser}.`);
			this.modlog(`ACHIEVEMENT REMOVE`, tarUser, achievement);
		},
		roomlist(target, room, user) {
			room = this.requireRoom();
			this.checkCan('ban', null, room);
			if (room.settings.isPrivate !== undefined) {
				return this.errorReply(`Only public rooms may use achievements.`);
			}
			room = this.requireRoom();
			this.checkCan('mute', null, room);
			let buf = `<strong>Achievements for ${room.title}</strong><br />`;
			const roomData = achievementData.roomdata[room.roomid];
			if (!roomData) return this.errorReply(`No achievements found.`);
			for (const k in roomData) {
				const achievement = roomData[k];
				buf += `<br />${achievement.title}: ${achievement.desc}`;
			}
			return this.sendReplyBox(buf);
		},
		""() {
			return this.parse(`/help achievements`);
		},
	},
	achievementshelp: [
		`/achievements list [target] - View the achievements of the [target] user (if one is given). Defaults to yourself.`,
		`/achievements roomadd [id, title, description] - Adds an achievement for the current room that staff can award. Requires: @ # &`,
		`/achievements roomdelete [id] - Removes the achievement with the given [id], if it exists. Requires: @ # &`,
		`/achievements roomgive [user], [achievement] - Gives the [user] the [achievement], if it exists. Requires: @ # &`,
		`/achievements roomremove [user], [achievement] - Removes the [achievement] from the [user], if they have it. Requires: @ # &`,
		`/achievements roomlist - Lists the current achievements in the room. Requires: % @ # &`,
	],
};

export const pages: PageTable = {
	achievements(query, user) {
		if (!user.named) return Rooms.RETRY_AFTER_LOGIN;
		const target = query.shift();
		this.title = `[Achievements] ${target || ""}`;
		if (target) {
			return Achievements.list(toID(target));
		}
		let buf = `<div class="pad"><h2>Achievement list</h2><hr />`;
		for (const type in achievements) {
			buf += `<h3>${type.charAt(0).toUpperCase() + type.slice(1)} achievements</h3><hr />`;
			const typeAchievements = achievements[type as AchievementTypes];
			for (const k in typeAchievements) {
				const handler = typeAchievements[k];
				buf += `<strong>${handler.title}</strong><br />`;
				buf += `${handler.desc}<hr />`;
			}
			buf += `<br />`;
		}
		return buf;
	},
};
