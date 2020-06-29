/**
 * Plugin to notify given rooms / the Development room on Pokemon Showdown
 * of github updates.
 * Some html / design from xfix's github bot, plugin by mia-pi.
 */
// @ts-ignore old enough module it has no types
import * as githubhook from 'githubhook';
import {Utils} from '../../lib/utils';

const cooldown = 15 * 60 * 1000;
const rooms: RoomID[] = Config.github?.rooms ? Config.github.rooms : ['staff', 'upperstaff', 'development'];

export const github = githubhook({
	port: (Config.github?.port || Config.port + 1),
	secret: (Config.github?.secret || ''),
});

github.on(
	'push',
	(repo: string, ref: string, result: AnyObject) => {
		return GithubParser.push(repo, ref, result);
	}
);

github.on(
	'pull_request',
	(repo: string, ref: string, result: AnyObject) => {
		return GithubParser.pull(repo, ref, result);
	}
);
export const GithubParser = new class {
	gitbans: Map<string, number | string>;
	pushes: AnyObject;
	constructor() {
		this.pushes = {};
		this.gitbans = new Map();
		this.gitbans.set('dependabot-preview[bot]', 'always');
	}
	shouldShow(id: string, repo: string) {
		id = toID(id);
		if (!this.pushes[id]) return true;
		if (this.gitbans.has(id)) return false;
		if (!this.pushes[repo]) this.pushes[repo] = {};
		if (Date.now() - this.pushes[repo][id] < cooldown) return true;
		if (Date.now() - this.pushes[repo][id] > cooldown) this.pushes[repo][id] = Date.now();
		return false;
	}
	repository(repo: string) {
		if (repo.includes('client')) return `client`;
		if (repo === 'pokemon-showdown') return `server`;
		if (repo.includes(`dex`)) return `dex`;
		return repo;
	}
	report(html: string) {
		Rooms.global.notifyRooms(rooms, `|c|~|/uhtml github,<div class="infobox">${html}</div>`);
	}
	push(repo: string, ref: string, result: AnyObject) {
		const url = result.compare;
		const buffer = result.commits.map((commit: AnyObject) => {
			const message = commit.message;
			const shortMessage = /.+/.exec(message)![0];
			const id = commit.id.slice(0, 6);
			const formattedRepo = `[<font color='FF00FF'>${this.repository(repo)}</font>]`;
			const userName = Utils.html`<font color='909090'>(${this.getName(commit.author.name)})</font>`;
			return `${formattedRepo} <a href="${url}"><font color='606060'>${id}</font></a> ${shortMessage} ${userName}`;
		}).join('<br/ >');
		if (!this.pushes[repo]) this.pushes[repo] = {};
		this.pushes[repo][result.pusher.name] = Date.now();
		this.report(buffer);
	}
	pull(repo: string, ref: string, result: AnyObject) {
		const committer = toID(result.sender.login);
		if (this.gitbans.has(committer)) return;
		const num = result.pull_request.number;
		const url = result.pull_request.html_url;
		const title = result.pull_request.title;
		const name = this.getName(result.sender.login);
		let action = result.action;
		if (action === 'synchronize') {
			action = 'updated';
		}
		if (action === 'review_requested') {
			action = 'requested a review for';
		}
		const blacklisted = ['converted_to_draft', 'ready_for_review', 'converted_to_draft'];
		if (blacklisted.includes(action)) {
			return;
		}
		this.report(
			`[<font color='FF00FF'>${repo}</font>] <font color='909090'>${name}</font> ` +
			`${action} <a href="${url}">PR#${num}</a>: ${title}`
		);
	}
	getName(name: string) {
		const devRoom = Rooms.get('development');
		if (!devRoom) return name;
		// @ts-ignore
		if (!devRoom.settings.usernames) devRoom.settings.usernames = {};
		// @ts-ignore
		if (devRoom.settings.usernames[name]) {
			// @ts-ignore
			return devRoom.settings.usernames[name];
		}
		return name;
	}
};

export const commands: ChatCommands = {
	git: 'github',
	github: {
		ban(target, room, user) {
			if (room.roomid !== 'development') return this.errorReply(`This command can only be used in the Development room.`);
			target = toID(target);
			if (!this.can('mute', null, room)) return false;
			if (GithubParser.gitbans.has(target)) return this.errorReply(`${target} is already gitbanned.`);
			GithubParser.gitbans.set(target, Date.now());
			this.privateModAction(`(${user.name} prevented ${target} from being reported by the plugin.)`);
			return this.modlog('GITBAN', null, target);
		},
		unban(target, room, user) {
			if (room.roomid !== 'development') return this.errorReply(`This command can only be used in the Development room.`);
			target = toID(target);
			if (!this.can('mute', null, room)) return false;
			if (!GithubParser.gitbans.has(target)) return this.errorReply(`${target} is not gitbanned.`);
			GithubParser.gitbans.delete(target);
			this.privateModAction(`(${user.name} allowed ${target} to be reported by the plugin.)`);
			return this.modlog('UNGITBAN', null, target);
		},
		bans(target, room, user) {
			if (room.roomid !== 'development') return this.errorReply(`This command can only be used in the Development room.`);
			if (!this.can('mute', null, room)) return false;
			let buf = `<strong>IDs banned from being reported by the Github Plugin</strong>:<hr/ >`;
			for (const [id, time] of GithubParser.gitbans) {
				buf += `- ${id}: ${typeof time === 'number' ? Chat.toTimestamp(new Date(time)) : time}<br/ >`;
			}
			return this.sendReplyBox(buf);
		},
		setname(target, room, user) {
			if (room.roomid !== 'development') return this.errorReply(`This command can only be used in the Development room.`);
			if (!this.can('ban', null, room)) return false;
			const [oldID, newName] = target.split(',');
			if (!target || !oldID || !newName) return this.errorReply(`Specify a GitHub username and new name.`);
			// @ts-ignore
			if (!room.settings.usernames) room.settings.usernames = {};
			// @ts-ignore
			if (room.settings.usernames[oldID] && room.settings.usernames[oldID] === newName) {
				return this.errorReply(`${oldID}'s GitHub plugin name is already ${newName}.`);
			}
			// @ts-ignore
			room.settings.usernames[oldID] = newName;
			room.saveSettings();
			this.sendReply(`Set ${oldID}'s name to be ${newName} in the Github Plugin.`);
			this.modlog(`GIT NAME`, null, `"${oldID}" to "${newName}"`);
		},
		resetname(target, room, user) {
			if (room.roomid !== 'development') return this.errorReply(`This command can only be used in the Development room.`);
			if (!this.can('ban', null, room)) return false;
			if (!target) return this.errorReply(`Specify a name.`);
			// @ts-ignore
			if (!(target in room.settings.usernames)) {
				return this.errorReply(`${target} does not have a name set for the Github Plugin.`);
			}
			// @ts-ignore
			delete room.settings.usernames[target];
			room.saveSettings();
			this.sendReply(`Reset ${target}'s name in the Github Plugin.`);
			return this.modlog(`GIT RESETNAME`, null, `${target}`);
		},
	},
};

github.listen();
